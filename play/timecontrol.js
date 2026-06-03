// ─── timecontrol.js ────────────────────────────────────────────────────────────
// Chess clock / time control for RedChess.
// Load AFTER game.js in your HTML:
//   bots.js → moveanimation.js → persistence.js → game.js → movelogic.js → engine.js → timecontrol.js
//
// Features:
//   • Bullet (1 min), Blitz (3 min), Rapid (10 min), Custom
//   • Increment support (e.g. 3+2 blitz)
//   • Works for local, bot, and online modes
//   • Auto-switches clock on applyMove
//   • Flags player on timeout → calls endGame()
//   • Exposes RedChessClock on window for UI wiring
// ──────────────────────────────────────────────────────────────────────────────

(function () {
    'use strict';

    // ─── Presets ──────────────────────────────────────────────────────────────
    const PRESETS = {
        bullet1:  { label: 'Bullet',  minutes: 1,  increment: 0 },
        bullet2:  { label: 'Bullet',  minutes: 2,  increment: 1 },
        blitz3:   { label: 'Blitz',   minutes: 3,  increment: 0 },
        blitz3i2: { label: 'Blitz',   minutes: 3,  increment: 2 },
        blitz5:   { label: 'Blitz',   minutes: 5,  increment: 0 },
        blitz5i3: { label: 'Blitz',   minutes: 5,  increment: 3 },
        rapid10:  { label: 'Rapid',   minutes: 10, increment: 0 },
        rapid15:  { label: 'Rapid',   minutes: 15, increment: 10 },
        rapid30:  { label: 'Rapid',   minutes: 30, increment: 0 },
        custom:   { label: 'Custom',  minutes: 5,  increment: 0 },
    };

    // ─── State ────────────────────────────────────────────────────────────────
    let _timeW       = 0;   // ms remaining for white
    let _timeB       = 0;   // ms remaining for black
    let _increment   = 0;   // ms added after each move
    let _running     = false;
    let _activeColor = 'w'; // whose clock is ticking
    let _interval    = null;
    let _lastTick    = null;
    let _preset      = null;
    let _enabled     = false;

    // ─── DOM refs (injected by buildUI) ──────────────────────────────────────
    let _elW = null; // white clock display element
    let _elB = null; // black clock display element

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
            _elW.textContent = _msToDisplay(_timeW);
            _elW.classList.toggle('clock-low',    _timeW > 0 && _timeW <= 10000);
            _elW.classList.toggle('clock-active',  _running && _activeColor === 'w');
            _elW.classList.toggle('clock-inactive',_running && _activeColor !== 'w');
        }
        if (_elB) {
            _elB.textContent = _msToDisplay(_timeB);
            _elB.classList.toggle('clock-low',    _timeB > 0 && _timeB <= 10000);
            _elB.classList.toggle('clock-active',  _running && _activeColor === 'b');
            _elB.classList.toggle('clock-inactive',_running && _activeColor !== 'b');
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
        const winner = color === 'w' ? 'b' : 'w';
        const getName = window._getPlayerName || ((c) => c === 'w' ? 'White' : 'Black');
        if (typeof endGame === 'function') {
            endGame(`${getName(color)} ran out of time — ${getName(winner)} wins`);
        } else if (typeof window.endGame === 'function') {
            window.endGame(`${getName(color)} ran out of time — ${getName(winner)} wins`);
        }
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    function init(minutes, incrementSecs) {
        const ms    = (minutes || 5) * 60 * 1000;
        _increment  = (incrementSecs || 0) * 1000;
        _timeW      = ms;
        _timeB      = ms;
        _activeColor = 'w';
        _enabled    = true;
        _stop();
        _updateDisplay();
    }

    function initPreset(presetKey) {
        const p = PRESETS[presetKey];
        if (!p) { console.warn('[timecontrol] unknown preset:', presetKey); return; }
        _preset = presetKey;
        init(p.minutes, p.increment);
    }

    function start() {
        if (!_enabled || _running) return;
        _running  = true;
        _lastTick = Date.now();
        _interval = setInterval(_tick, 100);
        _updateDisplay();
    }

    function _stop() {
        _running = false;
        if (_interval) { clearInterval(_interval); _interval = null; }
    }

    function stop() { _stop(); _updateDisplay(); }

    function pause() { _stop(); _updateDisplay(); }

    // Called after each move to switch the active clock + add increment
    function switchClock() {
        if (!_enabled) return;
        // Add increment to the player who just moved
        if (_activeColor === 'w') {
            _timeW = Math.min(_timeW + _increment, _timeW + _increment); // cap not needed but explicit
            _activeColor = 'b';
        } else {
            _timeB += _increment;
            _activeColor = 'w';
        }
        _lastTick = Date.now();
        _updateDisplay();
    }

    function reset() {
        _stop();
        if (_preset) {
            initPreset(_preset);
        } else {
            _timeW = 0; _timeB = 0;
            _enabled = false;
        }
        _updateDisplay();
    }

    function setDisplayElements(whiteEl, blackEl) {
        _elW = whiteEl;
        _elB = blackEl;
        _updateDisplay();
    }

    function getTime(color) {
        return color === 'w' ? _timeW : _timeB;
    }

    function isEnabled() { return _enabled; }

    // ─── Hook into applyMove ──────────────────────────────────────────────────
    // Patch window.applyMove so the clock switches automatically on every move.

    const _origApplyMove = window.applyMove;
    window.applyMove = function (fromRow, fromCol, toRow, toCol) {
        if (_origApplyMove) _origApplyMove(fromRow, fromCol, toRow, toCol);
        // Switch + start after first move (white's first move starts the clock)
        if (_enabled) {
            switchClock();
            if (!_running) start();
        }
    };

    // ─── Hook into endGame ────────────────────────────────────────────────────
    const _origEndGame = window.endGame;
    window.endGame = function (msg) {
        _stop();
        if (_origEndGame) _origEndGame(msg);
    };

    // ─── Build UI ─────────────────────────────────────────────────────────────
    // Injects a floating clock panel into the page.
    // Call RedChessClock.buildUI() after DOMContentLoaded.

    function buildUI() {
        // Inject styles
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
                color: #fff;
                letter-spacing: 1px;
                transition: color 0.2s;
            }
            .rc-clock-time.clock-active {
                color: #e8c97a;
            }
            .rc-clock-time.clock-inactive {
                color: rgba(255,255,255,0.35);
            }
            .rc-clock-time.clock-low {
                color: #e84040 !important;
                animation: rc-pulse 0.6s ease-in-out infinite alternate;
            }
            @keyframes rc-pulse {
                from { opacity: 1; }
                to   { opacity: 0.5; }
            }

            /* ── Selector modal ── */
            #rc-time-modal {
                display: none;
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.75);
                z-index: 10000;
                align-items: center;
                justify-content: center;
            }
            #rc-time-modal.open { display: flex; }
            #rc-time-card {
                background: #0f0f0f;
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 16px;
                padding: 32px 28px;
                width: 340px;
                max-width: 95vw;
                color: #fff;
                font-family: 'Courier New', monospace;
            }
            #rc-time-card h2 {
                margin: 0 0 6px;
                font-size: 18px;
                letter-spacing: 2px;
                text-transform: uppercase;
                color: #e8c97a;
            }
            #rc-time-card p {
                margin: 0 0 20px;
                font-size: 12px;
                color: rgba(255,255,255,0.4);
                letter-spacing: 1px;
            }
            .rc-preset-group {
                margin-bottom: 14px;
            }
            .rc-preset-group-label {
                font-size: 10px;
                letter-spacing: 2px;
                color: rgba(255,255,255,0.3);
                text-transform: uppercase;
                margin-bottom: 6px;
            }
            .rc-preset-row {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
            }
            .rc-preset-btn {
                background: rgba(255,255,255,0.05);
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 8px;
                color: #fff;
                font-family: 'Courier New', monospace;
                font-size: 13px;
                padding: 7px 13px;
                cursor: pointer;
                transition: background 0.15s, border-color 0.15s, color 0.15s;
            }
            .rc-preset-btn:hover, .rc-preset-btn.selected {
                background: #e8c97a;
                border-color: #e8c97a;
                color: #000;
            }
            .rc-custom-row {
                display: flex;
                gap: 10px;
                margin-top: 14px;
                align-items: center;
            }
            .rc-custom-row label {
                font-size: 11px;
                color: rgba(255,255,255,0.4);
                letter-spacing: 1px;
            }
            .rc-custom-row input {
                width: 58px;
                background: rgba(255,255,255,0.07);
                border: 1px solid rgba(255,255,255,0.15);
                border-radius: 6px;
                color: #fff;
                font-family: 'Courier New', monospace;
                font-size: 14px;
                padding: 6px 8px;
                text-align: center;
                outline: none;
            }
            .rc-modal-actions {
                display: flex;
                gap: 10px;
                margin-top: 22px;
            }
            .rc-btn-confirm {
                flex: 1;
                background: #e8c97a;
                border: none;
                border-radius: 8px;
                color: #000;
                font-family: 'Courier New', monospace;
                font-size: 14px;
                font-weight: 700;
                letter-spacing: 1px;
                padding: 11px;
                cursor: pointer;
                transition: opacity 0.15s;
            }
            .rc-btn-confirm:hover { opacity: 0.85; }
            .rc-btn-skip {
                background: transparent;
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 8px;
                color: rgba(255,255,255,0.4);
                font-family: 'Courier New', monospace;
                font-size: 13px;
                padding: 11px 16px;
                cursor: pointer;
                transition: border-color 0.15s, color 0.15s;
            }
            .rc-btn-skip:hover { border-color: rgba(255,255,255,0.3); color: #fff; }

            /* ── Clock settings button ── */
            #rc-clock-settings-btn {
                background: rgba(255,255,255,0.05);
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 8px;
                color: rgba(255,255,255,0.4);
                font-size: 16px;
                padding: 6px 0;
                cursor: pointer;
                text-align: center;
                transition: background 0.15s, color 0.15s;
            }
            #rc-clock-settings-btn:hover {
                background: rgba(232,201,122,0.12);
                color: #e8c97a;
            }
        `;
        document.head.appendChild(style);

        // Clock panel
        const panel = document.createElement('div');
        panel.id = 'rc-clock-panel';
        panel.innerHTML = `
            <div class="rc-clock-box" id="rc-clock-box-b">
                <div class="rc-clock-label">Black</div>
                <div class="rc-clock-time" id="rc-clock-b">—</div>
            </div>
            <div id="rc-clock-settings-btn" title="Change time control">⏱</div>
            <div class="rc-clock-box" id="rc-clock-box-w">
                <div class="rc-clock-label">White</div>
                <div class="rc-clock-time" id="rc-clock-w">—</div>
            </div>
        `;
        document.body.appendChild(panel);

        _elW = document.getElementById('rc-clock-w');
        _elB = document.getElementById('rc-clock-b');

        // Modal
        const modal = document.createElement('div');
        modal.id = 'rc-time-modal';
        modal.innerHTML = `
            <div id="rc-time-card">
                <h2>⏱ Time Control</h2>
                <p>Choose a preset or set custom time</p>

                <div class="rc-preset-group">
                    <div class="rc-preset-group-label">⚡ Bullet</div>
                    <div class="rc-preset-row">
                        <button class="rc-preset-btn" data-preset="bullet1">1+0</button>
                        <button class="rc-preset-btn" data-preset="bullet2">2+1</button>
                    </div>
                </div>

                <div class="rc-preset-group">
                    <div class="rc-preset-group-label">🔥 Blitz</div>
                    <div class="rc-preset-row">
                        <button class="rc-preset-btn" data-preset="blitz3">3+0</button>
                        <button class="rc-preset-btn" data-preset="blitz3i2">3+2</button>
                        <button class="rc-preset-btn" data-preset="blitz5">5+0</button>
                        <button class="rc-preset-btn" data-preset="blitz5i3">5+3</button>
                    </div>
                </div>

                <div class="rc-preset-group">
                    <div class="rc-preset-group-label">♟ Rapid</div>
                    <div class="rc-preset-row">
                        <button class="rc-preset-btn" data-preset="rapid10">10+0</button>
                        <button class="rc-preset-btn" data-preset="rapid15">15+10</button>
                        <button class="rc-preset-btn" data-preset="rapid30">30+0</button>
                    </div>
                </div>

                <div class="rc-preset-group">
                    <div class="rc-preset-group-label">🛠 Custom</div>
                    <div class="rc-custom-row">
                        <label>MINS</label>
                        <input type="number" id="rc-custom-min" min="1" max="180" value="5" />
                        <label>+INC</label>
                        <input type="number" id="rc-custom-inc" min="0" max="60"  value="0" />
                    </div>
                </div>

                <div class="rc-modal-actions">
                    <button class="rc-btn-confirm" id="rc-btn-confirm">Start Clock</button>
                    <button class="rc-btn-skip"    id="rc-btn-skip">No Clock</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // ── Modal logic ──
        let _selectedPreset = null;

        const presetBtns = modal.querySelectorAll('.rc-preset-btn');
        presetBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                presetBtns.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                _selectedPreset = btn.dataset.preset;
                // Fill custom fields to match preset for transparency
                const p = PRESETS[_selectedPreset];
                if (p) {
                    document.getElementById('rc-custom-min').value = p.minutes;
                    document.getElementById('rc-custom-inc').value = p.increment;
                }
            });
        });

        document.getElementById('rc-btn-confirm').addEventListener('click', () => {
            const mins = parseInt(document.getElementById('rc-custom-min').value) || 5;
            const inc  = parseInt(document.getElementById('rc-custom-inc').value) || 0;
            if (_selectedPreset && PRESETS[_selectedPreset]) {
                initPreset(_selectedPreset);
            } else {
                init(mins, inc);
            }
            modal.classList.remove('open');
            _updateDisplay();
        });

        document.getElementById('rc-btn-skip').addEventListener('click', () => {
            _enabled = false;
            modal.classList.remove('open');
            if (_elW) _elW.textContent = '—';
            if (_elB) _elB.textContent = '—';
        });

        // Settings cog reopens modal
        document.getElementById('rc-clock-settings-btn').addEventListener('click', () => {
            _stop();
            modal.classList.add('open');
        });

        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('open');
        });

        // Show modal on first load
        modal.classList.add('open');
    }

    // ─── Expose public API ────────────────────────────────────────────────────
    window.RedChessClock = {
        init,
        initPreset,
        start,
        stop,
        pause,
        reset,
        switchClock,
        setDisplayElements,
        getTime,
        isEnabled,
        buildUI,
        PRESETS,
    };

    // Auto-build UI after DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildUI);
    } else {
        buildUI();
    }

})();
