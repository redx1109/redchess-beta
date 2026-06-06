// ─── timecontrol.js ────────────────────────────────────────────────────────────
// Chess clock for RedChess.
// Load AFTER game.js in your HTML.
// Time control is set BEFORE the game via the bot/matchmaking/friend pages
// and saved to localStorage as 'chessTimeControl'.
// This file reads that setting and runs the clock — NO popup shown here.
//
// Clocks are rendered INSIDE the nameplates (opponent + player),
// not as a separate floating panel.
//
// For online games, online.js calls:
//   RedChessClock.getTimes()         — get current {w, b} ms to send to server
//   RedChessClock.syncFromServer(t)  — correct clock drift after opponent move
// ──────────────────────────────────────────────────────────────────────────────

(function () {
    'use strict';

    // ─── State ────────────────────────────────────────────────────────────────
    let _timeW       = 0;
    let _timeB       = 0;
    let _increment   = 0;
    let _running     = false;
    let _activeColor = 'w';
    let _interval    = null;
    let _lastTick    = null;
    let _enabled     = false;

    // Clock time <span> elements (inside nameplates)
    let _elW = null;   // #clock-w-time
    let _elB = null;   // #clock-b-time

    // Nameplate wrapper elements (for active/inactive/low classes)
    let _npW = null;   // #playerNameplate
    let _npB = null;   // #opponentNameplate

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _msToDisplay(ms) {
        if (ms <= 0) return '0:00';
        const totalSec = Math.ceil(ms / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function _setNameplateState(npEl, isActive, isLow) {
        if (!npEl) return;
        npEl.classList.toggle('clock-active',   isActive && !isLow);
        npEl.classList.toggle('clock-inactive', !isActive);
        npEl.classList.toggle('clock-low',      isLow);
    }

    function _updateDisplay() {
        const wIsActive = _enabled && _running && _activeColor === 'w';
        const bIsActive = _enabled && _running && _activeColor === 'b';
        const wIsLow    = _enabled && _timeW > 0 && _timeW <= 10000;
        const bIsLow    = _enabled && _timeB > 0 && _timeB <= 10000;

        if (_elW) _elW.textContent = _enabled ? _msToDisplay(_timeW) : '—';
        if (_elB) _elB.textContent = _enabled ? _msToDisplay(_timeB) : '—';

        _setNameplateState(_npW, wIsActive, wIsLow);
        _setNameplateState(_npB, bIsActive, bIsLow);
    }

    function _tick() {
        if (!_running) return;
        const now  = Date.now();
        const diff = now - _lastTick;
        _lastTick  = now;
        if (_activeColor === 'w') {
            _timeW = Math.max(0, _timeW - diff);
            if (_timeW === 0) { _timeout('w'); return; }
        } else {
            _timeB = Math.max(0, _timeB - diff);
            if (_timeB === 0) { _timeout('b'); return; }
        }
        _updateDisplay();
    }

    function _timeout(color) {
        _stop();
        // Flash flagged state
        const np = color === 'w' ? _npW : _npB;
        if (np) {
            np.classList.remove('clock-active', 'clock-low');
            np.classList.add('clock-flagged');
        }
        _updateDisplay();
        const winner  = color === 'w' ? 'b' : 'w';
        const getName = window._getPlayerName || ((c) => c === 'w' ? 'White' : 'Black');
        if (typeof window.endGame === 'function') {
            window.endGame(`${getName(color)} ran out of time — ${getName(winner)} wins`);
        }
    }

    function _stop() {
        _running = false;
        if (_interval) { clearInterval(_interval); _interval = null; }
    }

    // ─── Init from localStorage ───────────────────────────────────────────────

    function _initFromStorage() {
        let tcData = null;
        try { tcData = JSON.parse(localStorage.getItem('chessTimeControl') || 'null'); } catch(e) {}

        if (!tcData || !tcData.minutes) {
            _enabled = false;
            // Hide clock badges if no time control
            const cb = document.getElementById('clock-b');
            const cw = document.getElementById('clock-w');
            if (cb) cb.hidden = true;
            if (cw) cw.hidden = true;
            _updateDisplay();
            return;
        }

        const ms    = tcData.minutes * 60 * 1000;
        _increment  = (tcData.increment || 0) * 1000;
        _timeW      = ms;
        _timeB      = ms;
        _activeColor = 'w';
        _enabled    = true;
        _updateDisplay();
    }

    // ─── Public ───────────────────────────────────────────────────────────────

    function switchClock() {
        if (!_enabled) return;
        if (_activeColor === 'w') { _timeW += _increment; _activeColor = 'b'; }
        else                      { _timeB += _increment; _activeColor = 'w'; }
        _lastTick = Date.now();
        _updateDisplay();
    }

    function start() {
        if (!_enabled || _running) return;
        _running  = true;
        _lastTick = Date.now();
        _interval = setInterval(_tick, 100);
        _updateDisplay();
    }

    // ─── Online sync helpers ──────────────────────────────────────────────────

    function syncFromServer(times) {
        if (!_enabled) return;
        if (typeof times.w === 'number') _timeW = times.w;
        if (typeof times.b === 'number') _timeB = times.b;
        _updateDisplay();
    }

    function getTimes() {
        return { w: _timeW, b: _timeB };
    }

    // ─── Patch applyMove ─────────────────────────────────────────────────────

    const _origApplyMove = window.applyMove;
    window.applyMove = function (fromRow, fromCol, toRow, toCol) {
        if (_origApplyMove) _origApplyMove(fromRow, fromCol, toRow, toCol);
        if (_enabled) {
            switchClock();
            if (!_running) start();
        }
    };

    // ─── Patch endGame ────────────────────────────────────────────────────────

    const _origEndGame = window.endGame;
    window.endGame = function (msg) {
        _stop();
        if (_origEndGame) _origEndGame(msg);
    };

    // ─── Boot: wire up to existing nameplate elements ─────────────────────────

    function _boot() {
        _elW = document.getElementById('clock-w-time');
        _elB = document.getElementById('clock-b-time');
        _npW = document.getElementById('playerNameplate');
        _npB = document.getElementById('opponentNameplate');
        _initFromStorage();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _boot);
    } else {
        _boot();
    }

    window.RedChessClock = { start, switchClock, isEnabled: () => _enabled, syncFromServer, getTimes };

})();
