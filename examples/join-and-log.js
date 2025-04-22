const {Controller} = require('../dist');
const fs = require('fs');
const path = require('path');

const SERIAL = 'COM20';
const DB = './.zigbee_data/devices.db';
const DB_BACKUP = './.zigbee_data/devices.db.backup';
const ADAPTER_BACKUP = './.zigbee_data/adapter.backup';
const KEUS_DEVICE_ENDPOINT = 15;

// Load device metadata from JSON file
const deviceMetaInfoPath = path.resolve(__dirname, 'device_meta_info.json');
const deviceMetaInfoData = JSON.parse(fs.readFileSync(deviceMetaInfoPath, 'utf8'));

// Create lookup maps for device information
const deviceInfoByCategoryAndType = {};

// Process device metadata and organize by category and type IDs
deviceMetaInfoData.forEach(device => {
    const categoryId = device.dmDeviceCategory;
    const typeId = device.dmDeviceType;
    
    // Initialize category if it doesn't exist
    if (!deviceInfoByCategoryAndType[categoryId]) {
        deviceInfoByCategoryAndType[categoryId] = {};
    }
    
    // Store device info indexed by type ID
    deviceInfoByCategoryAndType[categoryId][typeId] = {
        deviceType: device.deviceType,
        deviceCategory: device.deviceCategory,
        categoryDisplayName: device.categoryDisplayName,
        typeDisplayName: device.typeDisplayName,
        chipType: device.chipType,
        isOtaUpgradeable: device.isOtaUpgradeable
    };
});

const coordinator = new Controller({
    serialPort: {path: SERIAL},
    databasePath: DB,
    databaseBackupPath: DB_BACKUP,
    backupPath: ADAPTER_BACKUP,
});

coordinator.on('message', async (msg) => {
    console.log(msg);
});

coordinator.on('permitJoinChanged', async (msg) => {
    if(msg.permitted) {
        console.log(msg);
        console.log('Permit join enabled for', msg.time, 'seconds');
    }
    else {
        console.log('Permit join disabled');
    }
});

coordinator.on('deviceJoined', (device) => {
    console.log('New device joined', device);
});

coordinator.on('deviceInterview', (interview) => {
    if(interview.status === 'successful') 
    {
        console.log('Device interview successful');

        const device = interview.device;
        if (device.isKeusDevice && device.manufacturerID === 0xAAAA) {
            console.log('Identified as Keus Device');
            
            let endpoint = device.getEndpoint(KEUS_DEVICE_ENDPOINT);
            let deviceId = endpoint.deviceID;
            let deviceType = deviceId & 0x00FF;
            let deviceCategory = (deviceId >> 8) & 0x00FF;
            let currentTimestamp = new Date().valueOf();
            
            // Look up device info from our indexed metadata
            const categoryInfo = deviceInfoByCategoryAndType[deviceCategory];
            const deviceInfo = categoryInfo && categoryInfo[deviceType];
            
            if (deviceInfo) {
                console.log("Time     : ", currentTimestamp);
                console.log("Category : ", deviceInfo.categoryDisplayName);
                console.log("Type     : ", deviceInfo.typeDisplayName);
                console.log("Device   : ", deviceInfo.deviceType);
                console.log("Chip     : ", deviceInfo.chipType);
                console.log("OTA      : ", deviceInfo.isOtaUpgradeable ? "Yes" : "No");
            } else {
                console.log("Unknown device category:", deviceCategory, "type:", deviceType);
            }
        }
        else {
            console.log(device.isKeusDevice)
            console.log(device.manufacturerID)
            console.log('Unknown device', device);
        }
    }
    else if(interview.status === 'failed') {
        console.log('Device interview failed', interview);
    }
    else {
        console.log('Device interview status', interview.status);
    }
});

coordinator
    .start()
    .then(() => {
        console.log('started with device', SERIAL);
        return coordinator.permitJoin(180);
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
