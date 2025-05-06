/**
 * Keus IoT Zigbee Molecular Service
 * This service uses Moleculer framework to manage Zigbee device connections
 */

// Moleculer-related imports
import { ServiceBroker } from 'moleculer';
import { Controller } from '../dist/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Middleware as ChannelsMiddleware } from "@moleculer/channels";

// Helper to get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment configuration
const NATS_URL = process.env.NATS_URL || "nats://100.82.115.91:9769"; // Ensure this is defined before getChannelsMiddleware
const NATS_TOKEN = process.env.NATS_TOKEN || 'keus-iot-platform';
const KEUS_ZIGBEE_ENDPOINT = 15;
const USE_LOCAL_MODE = true;

const NATS_OPTIONS = {
    url: NATS_URL,
    token: NATS_TOKEN,
    reconnect: true,
    maxReconnectAttempts: -1,
    waitOnFirstConnect: true           
}

// Configuration
const CONFIG = {
    SERIAL_PORT: process.env.ZIGBEE_SERIAL_PORT?? 'COM20',
    DB_PATH: process.env.ZIGBEE_DB_PATH?? './.zigbee_data/devices.db',
    DB_BACKUP_PATH: process.env.ZIGBEE_DB_BACKUP_PATH?? './.zigbee_data/devices.db.backup',
    ADAPTER_BACKUP_PATH: process.env.ZIGBEE_ADAPTER_BACKUP_PATH?? './.zigbee_data/adapter.backup',
    ZIBGEE_NWK_INFO_PATH: process.env.ZIGBEE_NWK_INFO_PATH?? './.zigbee_data/zigbee_nwk_info.json',
    KEUS_DEVICE_ENDPOINT: KEUS_ZIGBEE_ENDPOINT,
    KEUS_MASTER_ENDPOINT: KEUS_ZIGBEE_ENDPOINT,
    DEVICE_META_INFO_PATH: process.env.ZIGBEE_DEVICE_META_INFO_PATH?? path.resolve(__dirname, 'device_meta_info.json'),
    PING_INTERVAL_MS: process.env.ZIGBEE_PING_INTERVAL_MS?? 20000,
    PERMIT_JOIN_DURATION: process.env.ZIGBEE_PERMIT_JOIN_DURATION?? 180,
    CHANNEL_LIST: process.env.ZIGBEE_CHANNEL_LIST?? [15]
};

// Standard request options for Keus unicast messages
const GENERAL_UNICAST_REQ_OPTIONS = {
    disableDefaultResponse: true,
    response: true,
    timeout: 10000,
    srcEndpoint: CONFIG.KEUS_MASTER_ENDPOINT
};

// Define getChannelsMiddleware *after* natsUrl is defined
export const getChannelsMiddleware = ({
    streamName = "kiotp-default",
    namespace, // No default value
    subjects = [`p1.>`, `p2.>`, `default.>`],
    sendMethodName = "sendToStream",
    debug = false,
}) => {
    subjects = subjects.map(subject => `${namespace}.${subject}`);
    //@ts-ignore
    return ChannelsMiddleware({
        sendMethodName: sendMethodName,
        adapter: {
            type: "NATS",
            //@ts-ignore
            options: {
                nats: {
                    url: NATS_URL,
                    connectionOptions: {
                        token: NATS_TOKEN,
                        debug: debug,
                        reconnect: true,
                        maxReconnectAttempts: -1,
                        waitOnFirstConnect: true     
                    },
                    streamConfig: {
                        name: streamName,
                        subjects: subjects,
                        max_age: 12 * 60 * 60 * 1000 * 1000 * 1000 // 12 hours
                    },
                    consumerOptions: {
                        config: {
                            deliver_policy: "new",
                            ack_policy: "explicit",
                            ack_wait: 1 * 60 * 60 * 1000 * 1000 * 1000 // 1 hour
                        }
                    },
                },
                maxInFlight: 100000,
                maxRetries: 5
            }
        },

        context: true,
    })

}

/**
 * Device Manager class
 * Handles loading device metadata and organizing it for lookup
 */
class DeviceManager {

    platformNodeID;

    constructor(deviceMetaInfoPath, platformNodeID) {
        this.deviceInfoByCategoryAndType = {};
        this.loadDeviceMetaInfo(deviceMetaInfoPath);
        this.platformNodeID = platformNodeID;
    }

    loadDeviceMetaInfo(metaInfoPath) {
        try {
            const deviceMetaInfoData = JSON.parse(fs.readFileSync(metaInfoPath, 'utf8'));
            
            // Process device metadata and organize by category and type IDs
            deviceMetaInfoData.forEach(device => {
                const categoryId = device.dmDeviceCategory;
                const typeId = device.dmDeviceType;
                
                // Initialize category if it doesn't exist
                if (!this.deviceInfoByCategoryAndType[categoryId]) {
                    this.deviceInfoByCategoryAndType[categoryId] = {};
                }
                
                // Store device info indexed by type ID
                this.deviceInfoByCategoryAndType[categoryId][typeId] = {
                    deviceType: device.deviceType,
                    deviceCategory: device.deviceCategory,
                    categoryDisplayName: device.categoryDisplayName,
                    typeDisplayName: device.typeDisplayName,
                    chipType: device.chipType,
                    isOtaUpgradeable: device.isOtaUpgradeable
                };
            });
            
            console.log(`Loaded ${deviceMetaInfoData.length} device meta information records`);
        } catch (error) {
            console.error('Failed to load device meta information:', error);
            throw error;
        }
    }

    interpretDeviceIdentifier(deviceIdentifier) {
        let deviceType = deviceIdentifier & 0x00FF;
        let deviceCategory = (deviceIdentifier >> 8) & 0x00FF;

        return {deviceType, deviceCategory};
    }
        
    getDeviceInfo(categoryId, typeId) {
        const categoryInfo = this.deviceInfoByCategoryAndType[categoryId];
        return categoryInfo && categoryInfo[typeId];
    }

    /**
     * Load network information from config file or create default
     * @returns Network information object
     */
    getNetworkInfo() {
        let nwkInfo;
        try {
            if (fs.existsSync(CONFIG.ZIBGEE_NWK_INFO_PATH)) {
                nwkInfo = JSON.parse(fs.readFileSync(CONFIG.ZIBGEE_NWK_INFO_PATH, 'utf8'));
            }

            console.log("Read existing network info", nwkInfo);
        } catch (error) {
            console.log(`Error reading network info file: ${error.message}`);
        }
        
        if (!nwkInfo) {
            nwkInfo = {
                panID: Math.floor(Math.random() * 0xFFF0) + 1,
                channelList: CONFIG.CHANNEL_LIST
            };

            try {
                // Ensure directory exists
                const dirPath = CONFIG.ZIBGEE_NWK_INFO_PATH.substring(0, CONFIG.ZIBGEE_NWK_INFO_PATH.lastIndexOf('/'));
                if (dirPath && !fs.existsSync(dirPath)) {
                    fs.mkdirSync(dirPath, { recursive: true });
                }
                
                fs.writeFileSync(CONFIG.ZIBGEE_NWK_INFO_PATH, JSON.stringify(nwkInfo, null, 2));

                console.log("Created new network info", nwkInfo);
            } catch (error) {
                console.error(`Failed to create network info file: ${error.message}`);
            }
        }
        
        return nwkInfo;
    }
}

// Create a Moleculer broker with the loaded configuration
const broker = new ServiceBroker({
    namespace: "Keus-199786d6-saiteja-RandomId-af7f2a3ab9b0",
    nodeID: process.env.NODE_ID || "zcs_001",
    // Use transporter only in distributed mode
    transporter: USE_LOCAL_MODE ? null : {
        type: "NATS",
        options: NATS_OPTIONS
    },
    middlewares: [
        // Add Channels middleware for persistent messaging
        
        getChannelsMiddleware({})
    ]
});

// Define the Zigbee service using Moleculer
broker.createService({
    name: "zigbee",
    
    // Service settings
    settings: {
        config: CONFIG
    },
    
    // Service dependencies
    dependencies: [],
    
    // Service created lifecycle event handler
    created() {
        this.deviceManager = new DeviceManager(this.settings.config.DEVICE_META_INFO_PATH, this.broker.nodeID);
        
        // Get existing network info
        const nwkInfo = this.deviceManager.getNetworkInfo();

        this.coordinator = new Controller({
            network: nwkInfo,
            serialPort: {path: this.settings.config.SERIAL_PORT},
            databasePath: this.settings.config.DB_PATH,
            databaseBackupPath: this.settings.config.DB_BACKUP_PATH,
            backupPath: this.settings.config.ADAPTER_BACKUP_PATH,
        });
        
        // Setup event handlers
        this.coordinator.on('message', this.handleMessage.bind(this));
        this.coordinator.on('permitJoinChanged', this.handlePermitJoinChanged.bind(this));
        this.coordinator.on('deviceJoined', this.handleDeviceJoined.bind(this));
        this.coordinator.on('deviceInterview', this.handleDeviceInterview.bind(this));
    },
    
    // Service started lifecycle event handler
    async started() {
        try {
            this.logger.info("Starting Zigbee coordinator...");
            await this.coordinator.start();
            this.logger.info(`Zigbee service started with device ${this.settings.config.SERIAL_PORT}`);
            
            // Enable permit join for devices
            await this.coordinator.permitJoin(this.settings.config.PERMIT_JOIN_DURATION);

        } catch (error) {
            this.logger.error("Failed to start Zigbee service:", error);
            throw error;
        }
    },
    
    // Service stopped lifecycle event handler
    async stopped() {
        if (this.pingTimer) {
            clearTimeout(this.pingTimer);
        }
        
        if (this.coordinator) {
            try {
                await this.coordinator.stop();
                this.logger.info("Zigbee coordinator stopped");
            } catch (error) {
                this.logger.warn("Error stopping Zigbee coordinator:", error);
            }
        }
    },
    
    // Service methods
    methods: {
        handleMessage(msg) {
            this.logger.debug('Message received:', msg);
            //TODO: Handle non-keus messages
        },
        
        handlePermitJoinChanged(msg) {
            if(msg.permitted) {
                this.logger.info(`Permit join enabled for ${msg.time} seconds`);
                this.broker.broadcast("zigbee.permitJoinChanged", { permitted: true, time: msg.time });
            } else {
                this.logger.info('Permit join disabled');
                this.broker.broadcast("zigbee.permitJoinChanged", { permitted: false });
            }
        },
        
        handleDeviceJoined(device) {
            this.logger.info('New device joined: ', device.ieeeAddr);
        },
        
        async handleDeviceInterview(interview) {

            const device = interview.device;

            if(interview.status === 'successful') {
                this.logger.info('Device interview successful');

                if (device.isKeusDevice && device.manufacturerID === 0xAAAA) {
                    this.logger.info('Identified as Keus custom device');
                    
                    // Get device details
                    let endpoint = device.getEndpoint(this.settings.config.KEUS_DEVICE_ENDPOINT);
                    let deviceIdentifier = endpoint.deviceID;
                    let {deviceType, deviceCategory} = this.deviceManager.interpretDeviceIdentifier(deviceIdentifier);
                    let currentTimestamp = new Date().valueOf();
                    
                    // Look up device info from indexed metadata
                    const deviceInfo = this.deviceManager.getDeviceInfo(deviceType, deviceCategory);
                    
                    if (deviceInfo) 
                    {
                        this.logger.info("Device info:",{
                            timestamp: currentTimestamp,
                            category: deviceInfo.categoryDisplayName,
                            type: deviceInfo.typeDisplayName,
                            deviceType: deviceInfo.deviceType,
                            chipType: deviceInfo.chipType,
                            otaUpgradeable: deviceInfo.isOtaUpgradeable
                        });
                        
                        // Emit event with device details
                        this.broker.sendToStream("p1.zigbee.device.join", {
                            ieeeAddr: device.ieeeAddr,
                            timestamp: currentTimestamp,
                            deviceInfo: deviceInfo
                        });
                    } else {
                        this.logger.warn(`Unknown device category: ${deviceCategory}, type: ${deviceType}`);
                    }
                } else {
                    this.logger.info('Unknown zigbee device:', device.ieeeAddr);
                }
            } 
            else if(interview.status === 'failed') 
            {
                this.logger.warn('Device interview failed:', interview.device.ieeeAddr);
                this.logger.info('Removing device from network');
                device.removeFromNetwork();

            } else {
                this.logger.debug('Device interview status:', interview.status);
            }
        },
        
        async sendKeusAppUnicast(deviceId, clusterId, commandId, data) {
            try {
                let device = this.coordinator.getDeviceByIeeeAddr(deviceId);

                if (!device) {
                    return {
                        success: false,
                        error: 'Invalid Device'
                    };
                }

                let endpoint = device.getEndpoint(this.settings.config.KEUS_DEVICE_ENDPOINT);

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
            catch (err) {
                this.logger.error('Error sending Keus app unicast:', err);
                return {success: false, error: err};
            }
        },
    },
    
    // Service actions that can be called by other services or externally
    actions: {

        // Get all currently connected active devices
        getDevices: {
            handler() {
                const devices = [...this.coordinator.getDevicesIterator()].map(device => (
                    device.type === 'Router' || device.type === 'EndDevice'));
                
                return devices;
            }
        },
        
        // Toggle permit join status
        permitJoin: {
            params: {
                duration: { type: "number", optional: true, default: 60 }
            },
            async handler(ctx) {
                const duration = ctx.params.duration;
                await this.coordinator.permitJoin(duration);
                return { success: true, duration };
            }
        },
        
        // Manually send a command to a device
        sendCommand: {
            params: {
                ieeeAddr: { type: "string", optional: true},
                groupId: { type: "number", optional: true },
                sceneId: { type: "number", optional: true },
                clusterId: { type: "number" },
                commandId: { type: "number" },
                data: { type: "array", items: "number" }
            },
            async handler(ctx) 
            {
                const { ieeeAddr, groupId, sceneId, clusterId, commandId, data } = ctx.params;
                if(ieeeAddr)
                {
                    const response = await this.sendKeusAppUnicast(ieeeAddr, clusterId, commandId, data);
                    return response;
                }
                else 
                {
                    return {success: false, error: 'Currently not supported'};
                }
            }
        },
    },
    
    // Service events
    events: {}
});


// Start the broker
broker.start()
    .then(() => console.log("Broker started successfully"))
    .catch(err => {
        console.error("Failed to start broker:", err);
        process.exit(1);
    });
