-- Remove deprecated EVM deposit column (SQLite 3.35+). Optional for existing DBs.
-- sqlite3 data/solvequest.db < db/migrations/003_drop_evm_receive.sql

ALTER TABLE accounts DROP COLUMN evm_receive_address;
