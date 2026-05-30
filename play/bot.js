// ─── bot.js ────────────────────────────────────────────────────────────────────
// Bot config, board-flip, and player-name helpers.
// Load AFTER bots.js (defines getBotById / getBotName), BEFORE game.js.
// ──────────────────────────────────────────────────────────────────────────────

var _botCfg    = null;
try { _botCfg = JSON.parse(localStorage.getItem('botSettings') || 'null'); } catch(e) {}
var _botActive  = !!(_botCfg && _botCfg.active);
var _playerCol  = _botActive ? (_botCfg.playerColor || 'w') : null;
var _flipped    = window._flipped || (_playerCol === 'b');

window._botCfg   = _botCfg;
window._botActive = _botActive;
window._playerCol = _playerCol;
window._flipped   = _flipped;

// ─── Low-end / slow-network detection ─────────────────────────────────────────
var _isLowEnd = !!(
    (navigator.hardwareConcurrency != null && navigator.hardwareConcurrency <= 2) ||
    (navigator.deviceMemory        != null && navigator.deviceMemory        <= 2)
);
window._isLowEnd = _isLowEnd;

// ─── Player name helpers ───────────────────────────────────────────────────────

function _getPlayerName(color) {
    const me      = (typeof getUsername === 'function' && getUsername()) || 'Player';
    const botName = (typeof getBotName  === 'function' && getBotName())  || 'Bot';
    if (_botActive) {
        return color === _playerCol ? me : botName;
    }
    return color === 'w' ? me : 'Opponent';
}

// ─── Re-stamp bot name on opponent nameplate after updatePlayerBars runs ───────

function _fixBotOpponentName() {
    if (!_botActive || !_botCfg) return;
    const bot      = (typeof getBotById === 'function') ? getBotById(_botCfg.botId) : null;
    const nameEl   = document.getElementById('opponentName');
    const avatarEl = document.getElementById('opponentAvatar');
    const eloEl    = document.getElementById('opponentElo');
    if (nameEl)   nameEl.textContent   = bot ? bot.name      : 'Bot';
    if (avatarEl) avatarEl.textContent = bot ? bot.avatar    : '🤖';
    if (eloEl)    eloEl.textContent    = bot ? `~${bot.elo}` : '';
}

window._getPlayerName      = _getPlayerName;
window._fixBotOpponentName = _fixBotOpponentName;
