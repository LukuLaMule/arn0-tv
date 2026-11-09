/*
 * RSS headlines ticker for the home screen. Fetches /api/rss from the Arn0 backend.
 * Displays a scrolling ticker at the bottom of the screen.
 * URL configured via strava.url (same backend) in config.local.js.
 */
(function () {
    'use strict';

    var STORE_KEY  = 'arn0.rss.v1';
    var FRESH_MS   = 15 * 60 * 1000;
    var USABLE_MS  = 60 * 60 * 1000;
    var TIMEOUT_MS = 10000;
    var RETRY_MS   = 3  * 60 * 1000;

    function cfg() {
        // Reuse strava.url — same backend
        return (window.LAUNCHER_CONFIG && window.LAUNCHER_CONFIG.strava) || {};
    }

    function configured() {
        var url = cfg().url;
        return typeof url === 'string' && url.length > 0;
    }

    var reading = null;
    var fetching = false;
    var lastFailure = 0;
    var listeners = [];

    function load() {
        try { reading = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { reading = null; }
    }

    function store() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(reading)); } catch (e) {}
    }

    function age() {
        return reading && reading.at ? Date.now() - reading.at : Infinity;
    }

    function current() {
        if (!configured() || !reading || age() > USABLE_MS) return null;
        return reading.items;
    }

    function accept(data) {
        if (!data || !Array.isArray(data.items) || !data.items.length) return false;
        reading = { at: Date.now(), items: data.items };
        store();
        listeners.forEach(function (fn) { fn(); });
        return true;
    }

    function failed(why) {
        fetching = false;
        lastFailure = Date.now();
        DevLog.log('RSS: ' + why);
    }

    function refresh(force) {
        if (!configured() || fetching) return;
        if (!force && age() < FRESH_MS) return;
        if (!force && Date.now() - lastFailure < RETRY_MS) return;
        fetching = true;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', cfg().url.replace(/\/$/, '') + '/api/rss', true);
        xhr.timeout = TIMEOUT_MS;
        xhr.onload = function () {
            var ok = false;
            try {
                ok = xhr.status >= 200 && xhr.status < 300 && accept(JSON.parse(xhr.responseText));
            } catch (e) { ok = false; }
            if (ok) { fetching = false; lastFailure = 0; }
            else failed('unusable response (HTTP ' + xhr.status + ')');
        };
        xhr.onerror  = function () { failed('request failed'); };
        xhr.ontimeout = function () { failed('request timed out'); };
        xhr.send();
    }

    function start() {
        load();
        if (!configured()) { DevLog.log('RSS off: set strava.url in config.local.js'); return; }
        refresh();
    }

    window.RSS = {
        start:      start,
        refresh:    refresh,
        current:    current,
        configured: configured,
        onUpdate:   function (fn) { listeners.push(fn); }
    };
})();
