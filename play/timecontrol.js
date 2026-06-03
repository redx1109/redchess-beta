// ─── timecontrol.js ────────────────────────────────────────────────────────────
// Chess clock for RedChess.
// Load AFTER game.js in your HTML.
// Time control is set BEFORE the game via the bot/matchmaking/friend pages
// and saved to localStorage as 'chessTimeControl'.
// This file reads that setting and runs the clock — NO popup shown here.
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
    let _elW         = null;
    let _elB         = null;

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _msToDisplay(ms) {
        if (ms <= 0) return '0:00';
        const totalSec = Math.ceil(ms / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function _updateDisplay() {
        if (_elW) {
            _elW.textContent = _enabled ? _msToDisplay(_timeW) : '—';
            _elW.classList.toggle('clock-low',     _enabled && _timeW > 0 && _timeW <= 10000);
            _elW.classList.toggle('clock-active',  _enabled && _running && _activeColor === 'w');
            _elW.classList.toggle('clock-inactive',_enabled && _running && _activeColor !== 'w');
        }
        if (_elB) {
            _elB.textContent = _enabled ? _msToDisplay(_timeB) : '—';
            _elB.classList.toggle('clock-low',     _enabled && _timeB > 0 && _timeB <= 10000);
            _elB.classList.toggle('clock-active',  _enabled && _running && _activeColor === 'b');
            _elB.classList.toggle('clock-inactive',_enabled && _running && _activeColor !== 'b');
        }
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
        _updateDisplay();
        const winner  = color === 'w' ? 'b' : 'w';
        const getName = window._getPlayerName || ((c) => c === 'w' ? 'White' : 'Black');
        const fn = window.endGame;
        if (typeof fn === 'function') fn(`${getName(color)} ran out of time — ${getName(winner)} wins`);
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
            _updateDisplay();
            return;
        }

        const ms   = tcData.minutes * 60 * 1000;
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

    // ─── Build clock UI ───────────────────────────────────────────────────────

    function _buildUI() {
        const style = document.createElement('style');
        style.textContent = `
            #rc-clock-panel {
                position: fixed;
                top: 50%;
                right: 18px;
                transform: translateY(-50%);
                display: flex;
                flex-direction: column;
                gap: 10px;
                z-index: 999;
                font-family: 'Courier New', monospace;
                user-select: none;
            }
            .rc-clock-box {
                background: rgba(10,10,10,0.88);
                border: 1.5px solid rgba(255,255,255,0.08);
                border-radius: 10px;
                padding: 10px 18px;
                text-align: center;
                min-width: 90px;
                transition: border-color 0.2s, box-shadow 0.2s;
            }
            .rc-clock-label {
                font-size: 10px;
                letter-spacing: 2px;
                color: rgba(255,255,255,0.35);
                text-transform: uppercase;
                margin-bottom: 4px;
            }
            .rc-clock-time {
                font-size: 26px;
                font-weight: 700;
                color: rgba(255,255,255,0.25);
                letter-spacing: 1px;
                transition: color 0.2s;
            }
            .rc-clock-time.clock-active  { color: #e8c97a; }
            .rc-clock-time.clock-inactive { color: rgba(255,255,255,0.25); }
            .rc-clock-time.clock-low {
                color: #e84040 !important;
                animation: rc-pulse 0.6s ease-in-out infinite alternate;
            }
            @keyframes rc-pulse {
                from { opacity: 1; }
                to   { opacity: 0.45; }
            }
            @media (max-width: 600px) {
                #rc-clock-panel {
                    top: auto;
                    bottom: 70px;
                    right: 8px;
                    transform: none;
                }
                .rc-clock-time { font-size: 20px; }
                .rc-clock-box  { padding: 8px 12px; min-width: 70px; }
            }
        `;
        document.head.appendChild(style);

        const panel = document.createElement('div');
        panel.id = 'rc-clock-panel';
        panel.innerHTML = `
            <div class="rc-clock-box">
                <div class="rc-clock-label">Black</div>
                <div class="rc-clock-time" id="rc-clock-b">—</div>
            </div>
            <div class="rc-clock-box">
                <div class="rc-clock-label">White</div>
                <div class="rc-clock-time" id="rc-clock-w">—</div>
            </div>
        `;
        document.body.appendChild(panel);

        _elW = document.getElementById('rc-clock-w');
        _elB = document.getElementById('rc-clock-b');

        _initFromStorage();
    }

    // ─── Boot ─────────────────────────────────────────────────────────────────

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _buildUI);
    } else {
        _buildUI();
    }

    window.RedChessClock = { start, switchClock, isEnabled: () => _enabled };

})();
