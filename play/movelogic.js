// ─── movelogic.js ──────────────────────────────────────────────────────────────
// Pure chess-logic layer: no DOM, no game state.
// Requires: nothing. Consumed by: game.js (load this first via <script>).
// ──────────────────────────────────────────────────────────────────────────────

// ─── Board helpers ─────────────────────────────────────────────────────────────

function inBounds(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
}

// ─── Sliding-piece moves (rook / bishop / queen) ───────────────────────────────

function slideMoves(board, row, col, color, directions) {
    let moves = [];
    for (let [dr, dc] of directions) {
        let r = row + dr, c = col + dc;
        while (inBounds(r, c)) {
            let target = board[r][c];
            if (target === null)          { moves.push([r, c]); }
            else if (target[0] !== color) { moves.push([r, c]); break; }
            else                          { break; }
            r += dr; c += dc;
        }
    }
    return moves;
}

function rookMoves(board, row, col, color) {
    return slideMoves(board, row, col, color, [[-1,0],[1,0],[0,-1],[0,1]]);
}
function bishopMoves(board, row, col, color) {
    return slideMoves(board, row, col, color, [[-1,-1],[-1,1],[1,-1],[1,1]]);
}
function queenMoves(board, row, col, color) {
    return slideMoves(board, row, col, color,
        [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]);
}

// ─── Stepping-piece moves ──────────────────────────────────────────────────────

function knightMoves(board, row, col, color) {
    let moves = [];
    for (let [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        let r = row + dr, c = col + dc;
        if (inBounds(r, c)) {
            let t = board[r][c];
            if (t === null || t[0] !== color) moves.push([r, c]);
        }
    }
    return moves;
}

function kingMoves(board, row, col, color, castling = null) {
    let moves = [];
    for (let dr of [-1, 0, 1]) {
        for (let dc of [-1, 0, 1]) {
            if (dr === 0 && dc === 0) continue;
            let r = row + dr, c = col + dc;
            if (inBounds(r, c)) {
                let t = board[r][c];
                if (t === null || t[0] !== color) moves.push([r, c]);
            }
        }
    }
    if (castling) {
        const enemy   = color === 'w' ? 'b' : 'w';
        const backRow = color === 'w' ? 7 : 0;
        if (castling[color].K &&
            board[backRow][5] === null && board[backRow][6] === null &&
            !isAttacked(board, backRow, 4, enemy) &&
            !isAttacked(board, backRow, 5, enemy) &&
            !isAttacked(board, backRow, 6, enemy)) {
            moves.push([backRow, 6]);
        }
        if (castling[color].Q &&
            board[backRow][3] === null && board[backRow][2] === null && board[backRow][1] === null &&
            !isAttacked(board, backRow, 4, enemy) &&
            !isAttacked(board, backRow, 3, enemy) &&
            !isAttacked(board, backRow, 2, enemy)) {
            moves.push([backRow, 2]);
        }
    }
    return moves;
}

function pawnMoves(board, row, col, color, enPassant = null) {
    let moves = [];
    const dir      = color === 'w' ? -1 : 1;
    const startRow = color === 'w' ? 6  : 1;
    const r = row + dir;
    if (inBounds(r, col) && board[r][col] === null) {
        moves.push([r, col]);
        const r2 = row + 2 * dir;
        if (row === startRow && board[r2][col] === null) moves.push([r2, col]);
    }
    for (let dc of [-1, 1]) {
        const rc = row + dir, c = col + dc;
        if (inBounds(rc, c)) {
            const t = board[rc][c];
            if (t && t[0] !== color) moves.push([rc, c]);
            else if (enPassant && rc === enPassant[0] && c === enPassant[1]) moves.push([rc, c]);
        }
    }
    return moves;
}

// ─── Raw moves (no check-filter) ──────────────────────────────────────────────

function getRawMoves(board, row, col) {
    const piece = board[row][col];
    if (!piece) return [];
    const color = piece[0], ptype = piece[1];
    if (ptype === 'P') return pawnMoves(board, row, col, color);
    if (ptype === 'R') return rookMoves(board, row, col, color);
    if (ptype === 'B') return bishopMoves(board, row, col, color);
    if (ptype === 'Q') return queenMoves(board, row, col, color);
    if (ptype === 'N') return knightMoves(board, row, col, color);
    if (ptype === 'K') return kingMoves(board, row, col, color);
    return [];
}

// ─── Attack detection ──────────────────────────────────────────────────────────

function isAttacked(board, row, col, byColor) {
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = board[r][c];
            if (!p || p[0] !== byColor) continue;

            // Pawn attacks — handled separately (no loop-back through getRawMoves)
            if (p[1] === 'P') {
                const dir = byColor === 'w' ? -1 : 1;
                if (r + dir === row && (c - 1 === col || c + 1 === col)) return true;
                continue;
            }

            const moves = getRawMoves(board, r, c);
            for (const [mr, mc] of moves) {
                if (mr === row && mc === col) return true;
            }
        }
    }
    return false;
}

// ─── Check detection ───────────────────────────────────────────────────────────

function findKing(board, color) {
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (board[r][c] === color + 'K') return [r, c];
        }
    }
    return null;
}

function inCheck(board, color) {
    const king = findKing(board, color);
    if (!king) return false;
    return isAttacked(board, king[0], king[1], color === 'w' ? 'b' : 'w');
}

// ─── Legal moves (check-filtered) ─────────────────────────────────────────────

function getLegalMoves(board, row, col, castling = null, enPassant = null) {
    const piece = board[row][col];
    if (!piece) return [];
    const color = piece[0], ptype = piece[1];

    const raw =
        ptype === 'P' ? pawnMoves(board, row, col, color, enPassant) :
        ptype === 'R' ? rookMoves(board, row, col, color) :
        ptype === 'B' ? bishopMoves(board, row, col, color) :
        ptype === 'Q' ? queenMoves(board, row, col, color) :
        ptype === 'N' ? knightMoves(board, row, col, color) :
        ptype === 'K' ? kingMoves(board, row, col, color, castling) : [];

    return raw.filter(([r, c]) => {
        const test = JSON.parse(JSON.stringify(board));
        test[r][c]       = test[row][col];
        test[row][col]   = null;

        // Remove the en-passant captured pawn from the test board
        if (ptype === 'P' && enPassant && r === enPassant[0] && c === enPassant[1]
            && board[row][c] && board[row][c][1] === 'P') {
            test[row][c] = null;
        }

        return !inCheck(test, color);
    });
}

// ─── Algebraic notation ────────────────────────────────────────────────────────

const FILES = ['a','b','c','d','e','f','g','h'];

/**
 * Returns the algebraic notation string for a completed move.
 * castling / enPassant are read from the game.js globals (same script scope).
 */
function toAlgebraic(board, piece, fromRow, fromCol, toRow, toCol, captured, isCastle) {
    const ptype = piece[1];
    if (isCastle === 'K') return 'O-O';
    if (isCastle === 'Q') return 'O-O-O';

    const dest = FILES[toCol] + (8 - toRow);

    if (ptype === 'P') {
        const isEnPassant = !captured && enPassant && toRow === enPassant[0] && toCol === enPassant[1];
        if (captured || isEnPassant) return FILES[fromCol] + 'x' + dest;
        return dest;
    }

    const sym = { R:'R', N:'N', B:'B', Q:'Q', K:'K' }[ptype];

    // Disambiguation: find other same-type pieces that can also reach the destination
    const ambiguous = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (r === fromRow && c === fromCol) continue;
            if (board[r][c] !== piece) continue;
            // castling / enPassant are globals from game.js
            const moves = getLegalMoves(board, r, c, castling, enPassant);
            if (moves.some(([mr, mc]) => mr === toRow && mc === toCol))
                ambiguous.push([r, c]);
        }
    }

    let disambig = '';
    if (ambiguous.length > 0) {
        const sameFile = ambiguous.some(([,c]) => c === fromCol);
        const sameRank = ambiguous.some(([r]) => r === fromRow);
        if (!sameFile)      disambig = FILES[fromCol];
        else if (!sameRank) disambig = String(8 - fromRow);
        else                disambig = FILES[fromCol] + String(8 - fromRow);
    }

    return sym + disambig + (captured ? 'x' : '') + dest;
}
