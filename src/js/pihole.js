/*
 * Pi-hole stats for the home screen. Fetches /api/stats/summary from a Pi-hole v6 instance
 * on the local network.
 *
 * The URL is set in config.local.js (pihole.url), never hard-coded here, so this file can stay
 * in the repository without an address in it. Leave url null and the widget never appears.
 *
 * Cache and retry rules mirror weather.js: the reading is refreshed when the home screen becomes
 * visible, never more than once every five minutes; a stale reading hides the widget rather than
 * showing yesterday's numbers.
 */
(function () {
    'use strict';

    var STORE_KEY = 'arn0.pihole.v1';
    var FRESH_MS  = 5  * 60 * 1000;    // cached reading is good for five minutes
    var USABLE_MS = 30 * 60 * 1000;    // older than this counts as no reading at all
    var TIMEOUT_MS = 5000;
    var RETRY_MS  = 2  * 60 * 1000;    // quiet period after a failed attempt

    function cfg() {
        return (window.LAUNCHER_CONFIG && window.LAUNCHER_CONFIG.pihole) || {};
    }

    function configured() {
        var url = cfg().url;
        return typeof url === 'string' && url.length > 0;
    }

    // ---------- Cache

    var HISTORY_STORE = 'arn0.pihole-history.v1';
    var HISTORY_TTL   = 5 * 60 * 1000;

    var reading = null;
    var historyReading = null;
    var historyFetchedAt = 0;
    var fetching = false;
    var lastFailure = 0;
    var listeners = [];

    function load() {
        try {
            reading = JSON.parse(localStorage.getItem(STORE_KEY));
        } catch (e) {
            reading = null;
        }
    }

    function store() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(reading));
        } catch (e) {}
    }

    function age() {
        return reading && reading.at ? Date.now() - reading.at : Infinity;
    }

    function current() {
        if (!configured() || !reading || age() > USABLE_MS) return null;
        return { total: reading.total, blocked: reading.blocked,
                 percent: reading.percent, gravity: reading.gravity };
    }

    // ---------- Data

    function kilo(n) {
        return n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);
    }

    function accept(data) {
        if (!data || !data.queries) return false;
        var q = data.queries;
        var g = data.gravity;
        if (typeof q.total !== 'number' || typeof q.blocked !== 'number') return false;
        reading = {
            at:      Date.now(),
            total:   q.total,
            blocked: q.blocked,
            percent: Math.round(q.percent_blocked || 0),
            gravity: kilo((g && g.domains_being_blocked) || 0)
        };
        store();
        listeners.forEach(function (fn) { fn(); });
        return true;
    }

    function failed(why) {
        fetching = false;
        lastFailure = Date.now();
        DevLog.log('PiHole: ' + why);
    }

    // force: ignore cache rules (useful from the Lab screen).
    function refresh(force) {
        if (!configured() || fetching) return;
        if (!force && age() < FRESH_MS) return;
        if (!force && Date.now() - lastFailure < RETRY_MS) return;
        fetching = true;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', cfg().url.replace(/\/$/, '') + '/api/stats/summary', true);
        xhr.timeout = TIMEOUT_MS;
        xhr.onload = function () {
            var ok = false;
            try {
                ok = xhr.status >= 200 && xhr.status < 300 &&
                     accept(JSON.parse(xhr.responseText));
            } catch (e) {
                ok = false;
            }
            if (ok) {
                fetching = false;
                lastFailure = 0;
            } else {
                failed('unusable response (HTTP ' + xhr.status + ')');
            }
        };
        xhr.onerror  = function () { failed('request failed'); };
        xhr.ontimeout = function () { failed('request timed out'); };
        xhr.send();
    }

    function fetchHistory() {
        if (!window.LAUNCHER_CONFIG || !window.LAUNCHER_CONFIG.strava) return;
        var backendUrl = window.LAUNCHER_CONFIG.strava.url;
        if (!backendUrl) return;
        if (historyFetchedAt && Date.now() - historyFetchedAt < HISTORY_TTL) return;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', backendUrl.replace(/\/$/, '') + '/api/pihole/history', true);
        xhr.timeout = TIMEOUT_MS;
        xhr.onload = function () {
            try {
                if (xhr.status >= 200 && xhr.status < 300) {
                    var d = JSON.parse(xhr.responseText);
                    if (d && d.points) {
                        historyReading = d.points;
                        historyFetchedAt = Date.now();
                        try { localStorage.setItem(HISTORY_STORE, JSON.stringify(historyReading)); } catch(e) {}
                        listeners.forEach(function (fn) { fn(); });
                    }
                }
            } catch (e) {}
        };
        xhr.onerror = xhr.ontimeout = function () {};
        xhr.send();
    }

    function start() {
        load();
        try { historyReading = JSON.parse(localStorage.getItem(HISTORY_STORE)); } catch(e) {}
        if (!configured()) {
            DevLog.log('PiHole off: set pihole.url in config.local.js');
            return;
        }
        refresh();
        fetchHistory();
    }

    window.PiHole = {
        start:      start,
        refresh:    function (force) { refresh(force); fetchHistory(); },
        current:    current,
        history:    function () { return historyReading; },
        configured: configured,
        onUpdate:   function (fn) { listeners.push(fn); }
    };
})();
