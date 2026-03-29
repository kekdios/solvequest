/**
 * Loaded only for `npm run test:vault-puzzle`.
 * Sets PUZZLE_SOURCE=sqlite + temp paths so `puzzle.js` is the first import without env puzzle.
 */
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sq-vault-puz-"))
process.env.PUZZLE_SOURCE = "sqlite"
process.env.SQLITE_PATH = path.join(root, "vault.db")
process.env.SQLITE_BACKUP_DIR = path.join(root, "backups")
process.env.SQLITE_BACKUP_KEEP = "7"
process.env.QUEST_OPERATOR_SECRET_KEY = "5JtestOperatorKeyPlaceholder"
process.env.QUEST_MINT = "So11111111111111111111111111111111111111112"
process.env.QUEST_FUND_AMOUNT_RAW = "1"
delete process.env.ENCRYPTION_HKDF_SALT_HEX

delete process.env.TARGET_ADDRESS
delete process.env.SOLUTION_HASH
delete process.env.PUZZLE_WORDS

process.env._VAULT_PUZZLE_TEST_ROOT = root
