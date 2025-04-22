const {Controller} = require('../dist');

const SERIAL = 'COM20';
const DB = './.zigbee_data/devices.db';
const DB_BACKUP = './.zigbee_data/devices.db.backup';
const ADAPTER_BACKUP = './.zigbee_data/adapter.backup';

const coordinator = new Controller({
    serialPort: {path: SERIAL},
    databasePath: DB,
    databaseBackupPath: DB_BACKUP,
    backupPath: ADAPTER_BACKUP,
});

coordinator.on('message', async (msg) => {
    console.log(msg);
});

coordinator
    .start()
    .then(() => {
        console.log('started with device', SERIAL);
        return coordinator.permitJoin(true, null, 600);
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
