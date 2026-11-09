/*
 * Strava stats for the home screen. Fetches /api/strava from the local Pi backend,
 * which handles token refresh and caching server-side.
 *
 * The backend URL is set in config.local.js (strava.url), never hard-coded here.
 * Leave url null and the widget never appears.
 */
(function () {
    'use strict';

    var STORE_KEY = 'arn0.strava.v1';
    var FRESH_MS  = 5  * 60 * 1000;    // cached reading is good for five minutes
    var USABLE_MS = 60 * 60 * 1000;    // older than an hour counts as no reading at all
    var TIMEOUT_MS = 8000;
    var RETRY_MS  = 2  * 60 * 1000;

    function cfg() {
        return (window.LAUNCHER_CONFIG && window.LAUNCHER_CONFIG.strava) || {};
    }

    function configured() {
        var url = cfg().url;
        return typeof url === 'string' && url.length > 0;
    }

    // ---------- Cache

    var reading = null;
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
        return { last: reading.last, week: reading.week };
    }

    // ---------- Data

    function accept(data) {
        if (!data || (!data.last && !data.week)) return false;
        reading = { at: Date.now(), last: data.last || null, week: data.week || null };
        store();
        listeners.forEach(function (fn) { fn(); });
        return true;
    }

    function failed(why) {
        fetching = false;
        lastFailure = Date.now();
        DevLog.log('Strava: ' + why);
    }

    function refresh(force) {
        if (!configured() || fetching) return;
        if (!force && age() < FRESH_MS) return;
        if (!force && Date.now() - lastFailure < RETRY_MS) return;
        fetching = true;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', cfg().url.replace(/\/$/, '') + '/api/strava', true);
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

    function start() {
        load();
        if (!configured()) {
            DevLog.log('Strava off: set strava.url in config.local.js');
            return;
        }
        refresh();
    }

    window.Strava = {
        start:      start,
        refresh:    refresh,
        current:    current,
        configured: configured,
        onUpdate:   function (fn) { listeners.push(fn); }
    };
})();
