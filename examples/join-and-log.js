const {Controller} = require('../dist');
const fs = require('fs');
const path = require('path');

const SERIAL = 'COM20';
const DB = './.zigbee_data/devices.db';
const DB_BACKUP = './.zigbee_data/devices.db.backup';
const ADAPTER_BACKUP = './.zigbee_data/adapter.backup';
const KEUS_DEVICE_ENDPOINT = KEUS_MASTER_ENDPOINT = 15;

const GENERAL_UNICAST_REQ_OPTIONS = {
    disableDefaultResponse: true,
    response: true,
    timeout: 10000,
    srcEndpoint: KEUS_MASTER_ENDPOINT
};

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
    network: {
       channelList: [26],
    },
    serialPort: {path: SERIAL},
    databasePath: DB,
    databaseBackupPath: DB_BACKUP,
    backupPath: ADAPTER_BACKUP,
});

const sendKeusAppUnicast = async (deviceId, clusterId, commandId, data) => {
    try {
        let device = coordinator.getDeviceByIeeeAddr(deviceId);

        if (!device) {
            return {
                success: false,
                error: 'Invalid Device'
            };
        }

        let endpoint = device.getEndpoint(KEUS_DEVICE_ENDPOINT);

        if (!endpoint) {
            return {
                success: false,
                error: 'Invalid Endpoint'
            };
        }

        let keusAppMsgRsp = await endpoint.command(
            'keus',
            'appMsg',
            {
                clusterId: clusterId,
                commandId: commandId,
                dataLen: data.length,
                data: data
            },
            GENERAL_UNICAST_REQ_OPTIONS
        );

        return {
            success: true,
            rsp: keusAppMsgRsp
        };
    } 
    catch (err) 
    {
        console.error(err);
        return {success: false, error: err};
    }
};



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

coordinator.on('deviceInterview', async (interview) => {
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

            //query device info
            let requestData = Buffer.alloc(5);    // Create a 5-byte buffer
            requestData.writeUInt32LE(0x57edc, 0);  //at location 0x57edc 
            requestData.writeUInt8(150, 4);         //read 150 bytes

            let response = await sendKeusAppUnicast(deviceId, 21, 31, requestData);
            console.log(response);
            if(response.success) 
            {
                let responseData = response.rsp.data;
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

async function pingCheckDevices() {
    let devices = [...coordinator.getDevicesIterator(device => device.type === 'Router')];
    console.log(`pinging ${devices.length} devices`);

    for(let device of devices) {

        let response = await sendKeusAppUnicast(device.ieeeAddr, 1, 7, []);
        if(response.success) {
            console.log(`${device.ieeeAddr} is online`);
        }
        else {
            console.log(`pinging ${device.ieeeAddr} failed`);
        }
        
    }

    setTimeout(pingCheckDevices, 10000);
}

coordinator
    .start()
    .then(() => {
        console.log('started with device', SERIAL);

        setTimeout(pingCheckDevices, 5000);
        
        return coordinator.permitJoin(180);
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
