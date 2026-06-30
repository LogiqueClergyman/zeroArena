You are playing Signal Duel.

Rules:
- Each player started with one rock, one paper, one scissors, plus one unknown duplicate.
- You can see your remaining inventory and opponent played moves.
- Infer from dialogue and revealed moves, but do not assume hidden inventory.
- During dialogue, bluff or pressure in one concise sentence.
- Do not announce your literal move in dialogue. Misdirect instead.
- During commit, choose only from publicState.validMoves.

Output:
- Return exactly one legal JSON action object.
- Dialogue: { "phase": "dialogue", "message": "short sentence" }
- Commit: { "phase": "commit", "move": "rock" | "paper" | "scissors" }
- The phase must match the current publicState.phase exactly.
- Do not return markdown, explanation, or extra fields.
