// ─── mute-btn.js ──────────────────────────────────────────────────────────────
// Universal floating mute button. Include on EVERY page that has a
// <audio id="bgMusic"> element. Uses the same localStorage key as
// music-persist.js so mute state is shared across all pages.
// ──────────────────────────────────────────────────────────────────────────────

(function () {
    'use strict';

    const MUTE_KEY = 'isMusicMuted';

    function isMuted() {
        return localStorage.getItem(MUTE_KEY) === 'true';
    }

    function setMuted(val) {
        localStorage.setItem(MUTE_KEY, String(val));
    }

    function applyMuteState() {
        const btn   = document.getElementById('globalMuteBtn');
        const audio = document.getElementById('bgMusic');
        const muted = isMuted();

        if (btn) {
            btn.textContent = muted ? '🔇' : '🎵';
            btn.title       = muted ? 'Unmute music' : 'Mute music';
        }

        if (audio) {
            if (muted) {
                audio.pause();
            } else {
                // play() returns a promise — catch auto-play policy rejections silently
                audio.play().catch(() => {});
            }
        }
    }

    function injectBtn() {
        if (document.getElementById('globalMuteBtn')) return;

        // Styles
        if (!document.getElementById('_muteBtnStyles')) {
            const st = document.createElement('style');
            st.id = '_muteBtnStyles';
            st.textContent = `
                #globalMuteBtn {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    width: 44px;
                    height: 44px;
                    border-radius: 50%;
                    background: rgba(16, 16, 16, 0.88);
                    border: 1px solid rgba(255,255,255,0.12);
                    color: #fff;
                    font-size: 20px;
                    cursor: pointer;
                    z-index: 8500;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 22px rgba(0,0,0,0.55);
                    transition: background 0.15s, transform 0.12s;
                    backdrop-filter: blur(8px);
                    -webkit-backdrop-filter: blur(8px);
                    outline: none;
                }
                #globalMuteBtn:hover {
                    background: rgba(192, 57, 43, 0.82);
                    transform: scale(1.1);
                }
                #globalMuteBtn:active {
                    transform: scale(0.95);
                }
            `;
            document.head.appendChild(st);
        }

        const btn = document.createElement('button');
        btn.id = 'globalMuteBtn';
        document.body.appendChild(btn);

        btn.addEventListener('click', () => {
            setMuted(!isMuted());
            applyMuteState();
        });

        applyMuteState();
    }

    // Inject button as soon as body exists
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectBtn);
    } else {
        injectBtn();
    }

    // Re-apply after full load so audio element is definitely in the DOM
    window.addEventListener('load', applyMuteState);

})();