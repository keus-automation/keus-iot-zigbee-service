/**
 * Keus IoT Zigbee Molecular Service
 * This service uses Moleculer framework to manage Zigbee device connections
 */

// Moleculer-related imports
const { ServiceBroker } = require('moleculer');
const { Controller } = require('../dist');
const fs = require('fs');
const path = require('path');

// Load Moleculer configuration if it exists
let brokerConfig = {};
const configPath = path.resolve(__dirname, 'moleculer.config.js');
if (fs.existsSync(configPath)) {
    brokerConfig = require(configPath);
}

// Environment configuration
const useLocalMode = process.env.USE_LOCAL_MODE === "true" || false;
const natsUrl = process.env.NATS_URL || "nats://10.1.5.244:9769";
const natsToken = process.env.NATS_TOKEN || 'keus-iot-platform';

// Load Moleculer Channels middleware
const ChannelsMiddleware = require("@moleculer/channels").Middleware;

// Configuration
const CONFIG = {
    SERIAL_PORT: 'COM20',
    DB_PATH: './.zigbee_data/devices.db',
    DB_BACKUP_PATH: './.zigbee_data/devices.db.backup',
    ADAPTER_BACKUP_PATH: './.zigbee_data/adapter.backup',
    KEUS_DEVICE_ENDPOINT: 15,
    KEUS_MASTER_ENDPOINT: 15,
    DEVICE_META_INFO_PATH: path.resolve(__dirname, 'device_meta_info.json'),
    PING_INTERVAL_MS: 10000,
    PERMIT_JOIN_DURATION: 180
};

// Standard request options for Keus unicast messages
const GENERAL_UNICAST_REQ_OPTIONS = {
    disableDefaultResponse: true,
    response: true,
    timeout: 10000,
    srcEndpoint: CONFIG.KEUS_MASTER_ENDPOINT
};

/**
 * Device Manager class
 * Handles loading device metadata and organizing it for lookup
 */
class DeviceManager {
    constructor(deviceMetaInfoPath) {
        this.deviceInfoByCategoryAndType = {};
        this.loadDeviceMetaInfo(deviceMetaInfoPath);
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
    transporter: useLocalMode ? null : {
        type: "NATS",
        options: {
            url: natsUrl,
            token: natsToken,
        }
    },
    middlewares: [
        // Add Channels middleware for persistent messaging
        ChannelsMiddleware({
            adapter: {
                type: "NATS",
                options: {
                    nats: {
                        url: natsUrl,
                        connectionOptions: {
                            token: 'keus-iot-platform'
                        }
                    }
                }
            },
            sendMethodName: "sendToChannel"
        })
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
        this.deviceManager = new DeviceManager(this.settings.config.DEVICE_META_INFO_PATH);
        
        this.coordinator = new Controller({
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
            requestData.writeUInt8(150, 0);         // Read 150 bytes
            requestData.writeUInt32LE(0x57edc, 1);  // At location 0x57edc

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
                        await this.broker.sendToChannel("p1.zigbee.device.heartBeat", { 
                            deviceId: device.ieeeAddr,
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

            // Schedule next ping
            this.pingTimer = setTimeout(this.pingMonitorDevices.bind(this), this.settings.config.PING_INTERVAL_MS);
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
