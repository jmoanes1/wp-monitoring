import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api.js';
import { useSocket } from './SocketContext.jsx';
import { notificationEmoji, notificationLines } from '../utils/notificationCopy.js';

const DataContext = createContext(null);

function upsert(list, item, idKey = 'id') {
  if (!item) return list;
  if (item.deleted) return list.filter((entry) => entry[idKey] !== item[idKey]);
  const index = list.findIndex((entry) => entry[idKey] === item[idKey]);
  if (index === -1) return [item, ...list];
  const next = [...list];
  next[index] = { ...next[index], ...item };
  return next;
}

function isFormRecord(item) {
  return item?.type === 'form' || String(item?.type || '').startsWith('form_');
}

export function DataProvider({ children }) {
  const { socket } = useSocket();
  const [websites, setWebsites] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [history, setHistory] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [settings, setSettings] = useState(null);
  const [allowedIntervals, setAllowedIntervals] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [pluginUpdateProgress, setPluginUpdateProgress] = useState({});
  const [monitoring, setMonitoring] = useState({ running: false, lastCompletedAt: null });
  const [loading, setLoading] = useState(true);
  const toastTimers = useRef(new Map());

  const dismissToast = useCallback((id) => {
    const timer = toastTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback(
    (toast) => {
      const id = toast.id || `${Date.now()}-${Math.random()}`;
      const persist = Boolean(toast.persist);
      const previous = toastTimers.current.get(id);
      if (previous) {
        clearTimeout(previous);
        toastTimers.current.delete(id);
      }
      setToasts((current) => {
        const next = current.filter((item) => item.id !== id);
        return [{ ...toast, id }, ...next].slice(0, 6);
      });
      if (!persist) {
        const duration = toast.duration ?? (toast.tone === 'success' || toast.tone === 'info' ? 5000 : 8000);
        const timer = setTimeout(() => {
          setToasts((current) => current.filter((item) => item.id !== id));
          toastTimers.current.delete(id);
        }, duration);
        toastTimers.current.set(id, timer);
      }
    },
    []
  );

  const refresh = useCallback(async () => {
    const [sites, notifData, updateData, historyData, settingsData, incidentData] = await Promise.all([
      api('/websites'),
      api('/notifications'),
      api('/updates'),
      api('/monitoring/history'),
      api('/settings'),
      api('/incidents')
    ]);
    setWebsites(sites.websites || []);
    setNotifications((notifData.notifications || []).filter((item) => !isFormRecord(item)));
    setUpdates(updateData.updates || []);
    setHistory((historyData.history || []).filter((item) => item.type !== 'form'));
    setSettings(settingsData.settings);
    setAllowedIntervals(settingsData.allowedIntervals || []);
    setIncidents((incidentData.incidents || []).filter((item) => item.type !== 'form'));
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (!socket) return undefined;

    const onWebsite = (website) => {
      setWebsites((current) => upsert(current, website));
      if (website?.deleted && website.id) {
        const dropSite = (list) => list.filter((item) => item.websiteId !== website.id);
        setUpdates(dropSite);
        setIncidents(dropSite);
        setNotifications(dropSite);
        setHistory(dropSite);
        setPluginUpdateProgress((current) => {
          const next = { ...current };
          delete next[website.id];
          return next;
        });
      }
    };
    const onNotification = (notification) => {
      if (isFormRecord(notification)) return;
      setNotifications((current) => upsert(current, notification));
    };
    const onUpdate = (update) => setUpdates((current) => upsert(current, update));

    socket.on('website:updated', onWebsite);
    socket.on('website:statusChanged', (payload) => {
      setWebsites((current) =>
        current.map((site) => (site.id === payload.websiteId ? { ...site, status: payload.status, responseTime: payload.responseTime } : site))
      );
    });
    socket.on('incident:updated', (incident) => {
      if (incident?.type === 'form') return;
      setIncidents((current) => upsert(current, incident));
    });
    socket.on('update:detected', onUpdate);
    socket.on('update:resolved', onUpdate);
    socket.on('plugin:updateStarted', (payload) => {
      setPluginUpdateProgress((current) => ({ ...current, [payload.websiteId]: payload }));
      if (payload.current?.name) {
        pushToast({
          id: pluginToastId(payload.websiteId, payload.current.slug),
          tone: 'loading',
          persist: true,
          title: `Updating ${payload.current.name}...`
        });
      }
    });
    socket.on('plugin:updateProgress', (payload) => {
      setPluginUpdateProgress((current) => ({ ...current, [payload.websiteId]: payload }));
      const current = payload.current;
      if (!current?.name) return;
      const toastId = pluginToastId(payload.websiteId, current.slug);
      if (current.status === 'updating') {
        pushToast({
          id: toastId,
          tone: 'loading',
          persist: true,
          title: `Updating ${current.name}...`
        });
      } else if (current.status === 'success') {
        pushToast({
          id: toastId,
          tone: 'success',
          title: `✓ ${current.name} updated successfully`
        });
        if (payload.total > 1) {
          pushToast({
            id: `plugin-batch-${payload.websiteId}`,
            tone: 'info',
            title: `${payload.succeeded} of ${payload.total} plugins updated`
          });
        }
      } else if (current.status === 'failed') {
        pushToast({
          id: toastId,
          tone: 'error',
          persist: true,
          title: `✕ ${current.name} update failed`,
          body: current.error || 'The WordPress update reported an error.'
        });
      }
    });
    socket.on('plugin:updateCompleted', (payload) => {
      setPluginUpdateProgress((current) => ({ ...current, [payload.websiteId]: payload }));
      if (payload.total <= 1) return;
      const lines = pluginUpdateSummary(payload);
      if (!lines.length) return;
      const failedNames = (payload.items || [])
        .filter((item) => item.status === 'failed')
        .map((item) => item.name);
      pushToast({
        id: `plugin-batch-${payload.websiteId}`,
        tone: payload.status === 'completed' ? 'success' : payload.status === 'partial' ? 'warning' : 'error',
        persist: payload.status !== 'completed',
        title: lines[0],
        body: [lines[1], failedNames.length ? `Failed: ${failedNames.join(', ')}` : null].filter(Boolean).join(' · ') || undefined
      });
    });
    socket.on('notification:new', (notification) => {
      onNotification(notification);
      if (isFormRecord(notification)) return;
      pushToast({
        tone: notification.severity === 'critical' ? 'critical' : notification.severity === 'success' ? 'success' : 'warning',
        title: `${notificationEmoji(notification)} ${notification.title}`,
        lines: notificationLines(notification)
      });
      if (notification.severity === 'critical') {
        maybeBrowserNotify(notification.title, notification.message);
      }
    });
    socket.on('notification:updated', onNotification);
    socket.on('ssl:warning', ({ notification }) => {
      if (notification) onNotification(notification);
    });
    socket.on('monitoring:started', () => setMonitoring({ running: true, lastCompletedAt: null }));
    socket.on('monitoring:completed', (payload) => {
      setMonitoring({ running: false, lastCompletedAt: payload.completedAt });
      api('/monitoring/history')
        .then((data) => setHistory((data.history || []).filter((item) => item.type !== 'form')))
        .catch(() => {});
      api('/incidents')
        .then((data) => setIncidents((data.incidents || []).filter((item) => item.type !== 'form')))
        .catch(() => {});
    });

    return () => {
      [
        'website:updated',
        'website:statusChanged',
        'incident:updated',
        'update:detected',
        'update:resolved',
        'plugin:updateStarted',
        'plugin:updateProgress',
        'plugin:updateCompleted',
        'notification:new',
        'notification:updated',
        'ssl:warning',
        'website:offline',
        'website:recovered',
        'monitoring:started',
        'monitoring:completed'
      ].forEach((event) => socket.off(event));
    };
  }, [socket, pushToast]);

  const stats = useMemo(() => {
    const leads = websites.filter((item) => item.type === 'lead');
    const nonLeads = websites.filter((item) => item.type === 'non-lead');
    const offline = websites.filter((item) => item.status === 'offline');
    const pending = updates.filter((item) => item.status === 'pending');
    return {
      totalWebsites: websites.length,
      leadWebsites: leads.length,
      nonLeadWebsites: nonLeads.length,
      websitesOffline: offline.length,
      wordpressUpdates: pending.filter((item) => item.type === 'core').length,
      pluginUpdates: pending.filter((item) => item.type === 'plugin').length,
      themeUpdates: pending.filter((item) => item.type === 'theme').length,
      pendingUpdates: pending.length,
      criticalAlerts: offline.length,
      unreadNotifications: notifications.filter((item) => !item.read).length
    };
  }, [websites, updates, notifications]);

  const value = useMemo(
    () => ({
      websites,
      notifications,
      updates,
      history,
      incidents,
      settings,
      allowedIntervals,
      toasts,
      pluginUpdateProgress,
      monitoring,
      loading,
      stats,
      refresh,
      dismissToast,
      pushToast,
      setSettings,
      setNotifications,
      setWebsites,
      upsertWebsite: (website) => setWebsites((current) => upsert(current, website))
    }),
    [
      websites,
      notifications,
      updates,
      history,
      incidents,
      settings,
      allowedIntervals,
      toasts,
      pluginUpdateProgress,
      monitoring,
      loading,
      stats,
      refresh,
      dismissToast,
      pushToast
    ]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

function pluginToastId(websiteId, slug) {
  return `plugin-upd-${websiteId}-${slug}`;
}

function pluginUpdateSummary(payload) {
  const lines = [];
  if (payload.succeeded) {
    lines.push(`${payload.succeeded} plugin${payload.succeeded === 1 ? '' : 's'} updated successfully`);
  }
  if (payload.failed) {
    lines.push(`${payload.failed} plugin${payload.failed === 1 ? '' : 's'} failed to update`);
  }
  return lines;
}

function maybeBrowserNotify(title, body) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body });
  } catch {
    // Browser notification support is optional.
  }
}

export function useData() {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used within DataProvider');
  return context;
}
