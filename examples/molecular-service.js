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
import { createRequire } from 'module';

// Helper to get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Load Moleculer configuration if it exists
let brokerConfig = {};
const configPath = path.resolve(__dirname, 'moleculer.config.js');

// Use an IIFE to load the config potentially asynchronously (though require is sync)
(async () => {
    if (fs.existsSync(configPath)) {
        console.log(`Loading configuration from ${configPath}`);
        try {
            brokerConfig = require(configPath);
            console.log("Successfully loaded moleculer.config.js");
        } catch (e) {
            console.error("Error loading moleculer.config.js with createRequire:", e);
            brokerConfig = {};
        }
    } else {
        console.log("moleculer.config.js not found, using default configuration.");
    }
})(); // Immediately invoke the async function

// Environment configuration
const USE_LOCAL_MODE = process.env.USE_LOCAL_MODE === "true" || false;
const NATS_URL = process.env.NATS_URL || "nats://100.82.115.91:9769"; // Ensure this is defined before getChannelsMiddleware
const NATS_TOKEN = process.env.NATS_TOKEN || 'keus-iot-platform';

const NATS_OPTIONS = {
    url: NATS_URL,
    token: NATS_TOKEN,
    reconnect: true,
    maxReconnectAttempts: -1,
    waitOnFirstConnect: true           
}

// Configuration
const CONFIG = {
    SERIAL_PORT: 'COM20',
    DB_PATH: './.zigbee_data/devices.db',
    DB_BACKUP_PATH: './.zigbee_data/devices.db.backup',
    ADAPTER_BACKUP_PATH: './.zigbee_data/adapter.backup',
    KEUS_DEVICE_ENDPOINT: 15,
    KEUS_MASTER_ENDPOINT: 15,
    DEVICE_META_INFO_PATH: path.resolve(__dirname, 'device_meta_info.json'),
    PING_INTERVAL_MS: 20000,
    PERMIT_JOIN_DURATION: 180,
    CHANNEL_LIST: [15]
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

    getDeviceInfo(categoryId, typeId) {
        const categoryInfo = this.deviceInfoByCategoryAndType[categoryId];
        return categoryInfo && categoryInfo[typeId];
    }
}

// Create a Moleculer broker with the loaded configuration
const broker = new ServiceBroker({
    ...brokerConfig,
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
        
        this.coordinator = new Controller({
            network: {
                channelList: this.settings.config.CHANNEL_LIST,
            },
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
            
            // Start ping monitoring after a short delay
            this.pingTimer = setTimeout(this.pingMonitorDevices.bind(this), 5000);

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
            this.broker.broadcast("zigbee.message", { message: msg });
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
            this.logger.info('New device joined:', device.ieeeAddr);
            this.broker.broadcast("zigbee.deviceJoined", { device: { ieeeAddr: device.ieeeAddr, type: device.type } });
        },
        
        async handleDeviceInterview(interview) {
            if(interview.status === 'successful') {
                this.logger.info('Device interview successful');

                const device = interview.device;
                
                if (device.isKeusDevice && device.manufacturerID === 0xAAAA) {
                    this.logger.info('Identified as Keus Device');
                    
                    // Get device details
                    let endpoint = device.getEndpoint(this.settings.config.KEUS_DEVICE_ENDPOINT);
                    let deviceId = endpoint.deviceID;
                    let deviceType = deviceId & 0x00FF;
                    let deviceCategory = (deviceId >> 8) & 0x00FF;
                    let currentTimestamp = new Date().valueOf();
                    
                    // Look up device info from indexed metadata
                    const deviceInfo = this.deviceManager.getDeviceInfo(deviceCategory, deviceType);
                    
                    if (deviceInfo) {
                        this.logger.info({
                            timestamp: currentTimestamp,
                            category: deviceInfo.categoryDisplayName,
                            type: deviceInfo.typeDisplayName,
                            deviceType: deviceInfo.deviceType,
                            chipType: deviceInfo.chipType,
                            otaUpgradeable: deviceInfo.isOtaUpgradeable
                        }, "Device info");
                        
                        // Query additional device info
                        const extraInfo = await this.queryDeviceInfo(device.ieeeAddr);
                        
                        // Emit event with device details
                        this.broker.broadcast("zigbee.deviceIdentified", {
                            ieeeAddr: device.ieeeAddr,
                            timestamp: currentTimestamp,
                            deviceInfo: deviceInfo,
                            extraInfo: extraInfo
                        });
                    } else {
                        this.logger.warn(`Unknown device category: ${deviceCategory}, type: ${deviceType}`);
                        this.broker.broadcast("zigbee.unknownDeviceType", {
                            ieeeAddr: device.ieeeAddr,
                            category: deviceCategory,
                            type: deviceType
                        });
                    }
                } else {
                    this.logger.info('Unknown device:', device.ieeeAddr);
                    this.broker.broadcast("zigbee.unknownDevice", {
                        ieeeAddr: device.ieeeAddr,
                        manufacturerID: device.manufacturerID
                    });
                }
            } else if(interview.status === 'failed') {
                this.logger.warn('Device interview failed:', interview.device.ieeeAddr);
                this.broker.broadcast("zigbee.deviceInterviewFailed", {
                    ieeeAddr: interview.device.ieeeAddr
                });
            } else {
                this.logger.debug('Device interview status:', interview.status);
            }
        },
        
        async queryDeviceInfo(deviceId) {
            // Query device info by reading data from specific memory location
            let requestData = Buffer.alloc(5);
            requestData.writeUInt32LE(0x57edc, 0);  // At location 0x57edc
            requestData.writeUInt8(150, 4);         // Read 150 bytes

            let response = await this.sendKeusAppUnicast(deviceId, 21, 31, requestData);
            
            if(response.success) {
                this.logger.debug('Device info query successful');
                let responseData = response.rsp.data;
                // Process response data here if needed
                return responseData;
            }
            
            this.logger.warn('Device info query failed');
            return null;
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
        
        async pingMonitorDevices() {
            let devices = [...this.coordinator.getDevicesIterator(device => device.type === 'Router')];
            this.logger.info(`Pinging ${devices.length} devices`);

            const deviceStatuses = [];
            for(let device of devices) {
                let response = await this.sendKeusAppUnicast(device.ieeeAddr, 1, 7, []);
                const isOnline = response.success;
                
                deviceStatuses.push({
                    ieeeAddr: device.ieeeAddr,
                    online: isOnline
                });
                
                if(isOnline) {
                    this.logger.debug(`${device.ieeeAddr} is online`);
                    
                    // Send heartbeat message for online device using channels
                    try {

                        await this.broker.sendToStream("p1.zigbee.parallel.events.heartBeat", { 
                                data: {
                                deviceId: device.ieeeAddr,
                            },
                            deviceCategory: 7,
                            deviceType: 1,
                            eventType: "DEVICE_HEARTBEAT",
                            timestamp: Date.now()
                        });
                        
                        this.logger.debug(`Heartbeat sent for device ${device.ieeeAddr}`);
                        
                    } catch (err) {
                        this.logger.warn(`Failed to send heartbeat for device ${device.ieeeAddr}:`, err.message);
                    }
                } else {
                    this.logger.warn(`Pinging ${device.ieeeAddr} failed`);
                }
            }
            
            // Broadcast device statuses
            this.broker.broadcast("zigbee.deviceStatuses", { devices: deviceStatuses });

            this.getRoutingTable();

            // Schedule next ping
            this.pingTimer = setTimeout(this.pingMonitorDevices.bind(this), this.settings.config.PING_INTERVAL_MS);

        
        },

        async getRoutingTable() {

            try {
                this.logger.info("Getting routing table");
                let device = this.coordinator.getDeviceByIeeeAddr("0x00124b0027635b1d");

                if (!device) {
                    this.logger.error("Invalid Device");
                    return;
                }

                let routingTable = await device.routingTable();
                this.logger.info(`Routing table: ${JSON.stringify(routingTable)}`);
            } 
            catch (err) {
                this.logger.error('Failed to get routing table:', err);
                return {success: false, error: err};
            }
        }
    },
    
    // Service actions that can be called by other services or externally
    actions: {
        // Get all currently connected devices
        getDevices: {
            handler() {
                const devices = [...this.coordinator.getDevicesIterator()].map(device => ({
                    ieeeAddr: device.ieeeAddr,
                    networkAddress: device.networkAddress,
                    type: device.type,
                    manufacturerID: device.manufacturerID,
                    manufacturerName: device.manufacturerName,
                    isKeusDevice: device.isKeusDevice || false
                }));
                
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
                deviceId: { type: "string" },
                clusterId: { type: "number" },
                commandId: { type: "number" },
                data: { type: "array", items: "number" }
            },
            async handler(ctx) {
                const { deviceId, clusterId, commandId, data } = ctx.params;
                const response = await this.sendKeusAppUnicast(deviceId, clusterId, commandId, data);
                return response;
            }
        },

        getFactoryInfo: {
            async handler(ctx) {
                const { deviceId } = ctx.params;

                this.logger.info(`Getting factory info for device ${deviceId}`);

                //query device info
                let requestData = Buffer.alloc(5);    // Create a 5-byte buffer
                requestData.writeUInt32LE(0x57edc, 0);  //at location 0x57edc 
                requestData.writeUInt8(150, 4);         //read 150 bytes

                // let response = await this.sendKeusAppUnicast(deviceId, 21, 31, requestData);
                // console.log(response);
                
                // let factoryInfoRsp = {
                //     success: response.success,
                //     info: response.rsp.data
                // };

                //this.logger.info(`Factory info for device ${deviceId}: ${JSON.stringify(factoryInfoRsp)}`);

                return {success: false, info: null};
                // return factoryInfoRsp;
            }
        },
        
        // Ping a specific device
        pingDevice: {
            params: {
                deviceId: { type: "string" }
            },
            async handler(ctx) {
                const { deviceId } = ctx.params;
                const response = await this.sendKeusAppUnicast(deviceId, 1, 7, []);
                
                // Send heartbeat on successful ping
                if (response.success) {
                    try {
                        await this.broker.sendToStream("p1.zigbee.device.heartBeat", { 
                            deviceId: deviceId,
                            timestamp: Date.now()
                        });
                    } catch (err) {
                        this.logger.warn(`Failed to send heartbeat for device ${deviceId}:`, err.message);
                    }
                }
                
                return {
                    ieeeAddr: deviceId,
                    online: response.success
                };
            }
        }
    },
    
    // Service events
    events: {
        // Example of handling an event from another service
        "otherService.event": {
            handler(ctx) {
                this.logger.info("Received event from another service:", ctx.params);
            }
        }
    }
});

// Create a second service to demonstrate Moleculer's inter-service communication
broker.createService({
    name: "zigbeeMonitor",
    
    created() {
        this.deviceStatuses = new Map();
    },
    
    events: {
        // Subscribe to device status updates
        "zigbee.deviceStatuses": {
            handler(ctx) {
                const devices = ctx.params.devices;
                
                devices.forEach(device => {
                    this.deviceStatuses.set(device.ieeeAddr, {
                        online: device.online,
                        lastSeen: new Date()
                    });
                });
                
                this.logger.info(`Updated status for ${devices.length} devices`);
            }
        },
        
        // Subscribe to device identified events
        "zigbee.deviceIdentified": {
            handler(ctx) {
                const { ieeeAddr, deviceInfo } = ctx.params;
                this.logger.info(`Device identified: ${deviceInfo.deviceType} (${ieeeAddr})`);
            }
        }
    },
    
    actions: {
        // Get all device statuses
        getDeviceStatuses: {
            handler() {
                const result = {};
                
                this.deviceStatuses.forEach((status, ieeeAddr) => {
                    result[ieeeAddr] = status;
                });
                
                return result;
            }
        }
    }
});

// Start the broker
broker.start()
    .then(() => console.log("Broker started successfully"))
    .catch(err => {
        console.error("Failed to start broker:", err);
        process.exit(1);
    });
