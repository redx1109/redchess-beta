/**
 * music-persist.js
 * Add to every page (after the <audio id="bgMusic"> element) to keep
 * music playing seamlessly across navigation.
 *
 * Usage in each HTML page:
 *   <audio id="bgMusic" loop>
 *     <source src="/sounds/Aftertherain.mp3" type="audio/mpeg">
 *   </audio>
 *   <script src="/music-persist.js"></script>
 */
(function () {
  var audio = document.getElementById('bgMusic');
  if (!audio) return;

  audio.volume = 0.45;

  // Restore mute state
  var wasMuted = sessionStorage.getItem('musicMuted') === '1';
  if (wasMuted) audio.muted = true;

  // Restore playback position and auto-play if music was on
  var savedTime    = parseFloat(sessionStorage.getItem('musicTime')    || '0');
  var wasPlaying   = sessionStorage.getItem('musicPlaying') !== '0';   // default: play
  var hasEntered   = sessionStorage.getItem('entered') === '1';

  if (hasEntered) {
    if (savedTime > 0) {
      try { audio.currentTime = savedTime; } catch (e) {}
    }
    if (wasPlaying || !wasMuted) {
      audio.play().catch(function () {});
    }
  }

  // Continuously save state
  setInterval(function () {
    try {
      sessionStorage.setItem('musicTime',    audio.currentTime.toString());
      sessionStorage.setItem('musicPlaying', (!audio.paused) ? '1' : '0');
    } catch (e) {}
  }, 500);

  // Save before leaving
  window.addEventListener('pagehide',      saveState);
  window.addEventListener('beforeunload',  saveState);

  function saveState() {
    try {
      sessionStorage.setItem('musicTime',    audio.currentTime.toString());
      sessionStorage.setItem('musicPlaying', (!audio.paused) ? '1' : '0');
      sessionStorage.setItem('musicMuted',   audio.muted ? '1' : '0');
    } catch (e) {}
  }

  // Wire up optional music button (same as index.html)
  var btn = document.getElementById('musicBtn');
  if (!btn) return;

  btn.style.display = 'flex';
  if (wasMuted) { btn.innerHTML = '&#128263;'; btn.style.opacity = '0.3'; }

  btn.addEventListener('click', function () {
    audio.muted = !audio.muted;
    btn.innerHTML = audio.muted ? '&#128263;' : '&#128266;';
    btn.style.opacity = audio.muted ? '0.3' : '0.6';
    sessionStorage.setItem('musicMuted', audio.muted ? '1' : '0');
  });
  btn.addEventListener('mouseenter', function () { btn.style.opacity = '1'; btn.style.background = 'rgba(201,168,76,.2)'; });
  btn.addEventListener('mouseleave', function () { btn.style.opacity = audio.muted ? '0.3' : '0.6'; btn.style.background = 'rgba(201,168,76,.1)'; });
})();