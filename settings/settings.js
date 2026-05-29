// ─── Config ────────────────────────────────────────────────────────────────────

const BOARDS      = ["gold","newspaper","metal","icy_sea", "green", "bluemetal", "wood", "wood3", "green-plastic", "leather","stone","brown"];
const PIECES      = ["default","classic","icy_sea",'newspaper'];
const MOVE_STYLES = ["click", "drag", "both"];
const SHADOWS = ["on", "off"];

function buildShadowPicker() {
    const select = document.getElementById("boardShadow");
    select.innerHTML = "";
    SHADOWS.forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
        if (name === (saved.shadow || "on")) opt.selected = true;
        select.appendChild(opt);
    });
}
// ─── Load saved settings ───────────────────────────────────────────────────────

const saved = JSON.parse(localStorage.getItem("chessSettings") || "{}");
let selectedBoard = saved.board     || BOARDS[0];
let selectedPiece = saved.piece     || PIECES[0];
let selectedMoveStyle = saved.moveStyle || MOVE_STYLES[2];
let selectedShadow = saved.shadow     || SHADOWS[0];

// ─── Board thumbnail grid ──────────────────────────────────────────────────────

function buildBoardPicker() {
    const container = document.getElementById("boardPicker");
    container.innerHTML = "";

    BOARDS.forEach(name => {
        const card = document.createElement("div");
        card.classList.add("board-card");
        if (name === selectedBoard) card.classList.add("selected");

        const img = document.createElement("img");
        img.src = `../boards/${name}.jpg`;
        img.alt = name;

        const label = document.createElement("span");
        label.textContent = name.charAt(0).toUpperCase() + name.slice(1);

        card.appendChild(img);
        card.appendChild(label);

        card.addEventListener("click", () => {
            selectedBoard = name;
            document.querySelectorAll(".board-card").forEach(c => c.classList.remove("selected"));
            card.classList.add("selected");
        });

        container.appendChild(card);
    });
}

// ─── Piece style selector ──────────────────────────────────────────────────────

function buildPiecePicker() {
    const select = document.getElementById("pieceStyle");
    select.innerHTML = "";

    PIECES.forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
        if (name === selectedPiece) opt.selected = true;
        select.appendChild(opt);
    });

    select.addEventListener("change", () => {
        selectedPiece = select.value;
    });
}

// ─── Move style selector ───────────────────────────────────────────────────────

function buildMoveStylePicker() {
    const select = document.getElementById("moveStyle");
    select.innerHTML = "";

    MOVE_STYLES.forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
        if (name === (saved.moveStyle || "both")) opt.selected = true;
        select.appendChild(opt);
    });
}

// ─── Save ──────────────────────────────────────────────────────────────────────

function saveSettings() {
    localStorage.setItem("chessSettings", JSON.stringify({
        board:     selectedBoard,
        piece:     selectedPiece,
        moveStyle: document.getElementById("moveStyle").value
    }));

    const btn = document.getElementById("saveBtn");
    btn.textContent = "Saved!";
    setTimeout(() => btn.textContent = "Save", 1500);
}

// ─── Init ──────────────────────────────────────────────────────────────────────

buildBoardPicker();
buildPiecePicker();
buildMoveStylePicker();
buildShadowPicker();
