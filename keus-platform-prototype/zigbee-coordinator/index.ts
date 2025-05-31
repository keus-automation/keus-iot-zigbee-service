/**
 * Keus IoT Zigbee Coordinator Service
 * This service uses Moleculer framework to manage Zigbee device connections
 */

import Moleculer, { ServiceBroker } from 'moleculer';
import fs from 'fs';
import * as ZigbeeCoordinatorDriver from "../../dist";
import { 
    ZIGBEE_CONFIG, 
    GENERAL_UNICAST_REQ_OPTIONS,
    NODE_ID
} from './constants';
import { 
    DeviceIdentifier, 
    DeviceJoinEvent, 
    DeviceMetaInfoByCategory,
    PermitJoinParams
} from "./interfaces";



/**
 * Device Manager class
 * Handles loading device metadata and organizing it for lookup
 */
class DeviceManager {
    
    deviceInfoByCategoryAndType: DeviceMetaInfoByCategory;
    platformNodeID: string;

    constructor(deviceMetaInfoPath: string, platformNodeID: string) {
        this.deviceInfoByCategoryAndType = {};
        this.loadDeviceMetaInfo(deviceMetaInfoPath);
        this.platformNodeID = platformNodeID;
    }

    loadDeviceMetaInfo(metaInfoPath: string): void {
        try {
            const deviceMetaInfoData = JSON.parse(fs.readFileSync(metaInfoPath, 'utf8'));
            
            // Process device metadata and organize by category and type IDs
            deviceMetaInfoData.forEach((device: any) => {
                const categoryId = device.dmDeviceCategory;
                const typeId = device.dmDeviceType;
                
                // Initialize category if it doesn't exist
                if (!this.deviceInfoByCategoryAndType[categoryId]) {
                    this.deviceInfoByCategoryAndType[categoryId] = {};
                }
                
                // Store device info indexed by type ID
                this.deviceInfoByCategoryAndType[categoryId][typeId] = deviceMetaInfoData;
            });
            
            console.log(`Loaded ${deviceMetaInfoData.length} device meta information records`);
        } catch (error) {
            console.error('Failed to load device meta information:', error);
            throw error;
        }
    }

    interpretDeviceIdentifier(deviceIdentifier: number): DeviceIdentifier {
        let deviceType = deviceIdentifier & 0x00FF;
        let deviceCategory = (deviceIdentifier >> 8) & 0x00FF;

        return { deviceType, deviceCategory };
    }
        
    getDeviceInfo(categoryId: number, typeId: number): any | undefined {
        const categoryInfo = this.deviceInfoByCategoryAndType[categoryId];
        return categoryInfo && categoryInfo[typeId];
    }
}

/**
 * Zigbee Coordinator Service
 */
class ZigbeeCoordinatorService extends Moleculer.Service {
    private deviceManager: DeviceManager;
    private coordinator?: any;
    private pingTimer?: NodeJS.Timeout;

    constructor(broker: Moleculer.ServiceBroker, nodeId: string) {
        super(broker);
               
        this.parseServiceSchema({
            name: "zigbee_coordinator",
            version: "v1",
            
            // Service settings
            settings: {
                config: ZIGBEE_CONFIG
            },
            
            // Service dependencies
            dependencies: [],
            
            // Service lifecycle events
            created: this.serviceCreated,
            started: this.serviceStarted,
            stopped: this.serviceStopped,
            
            // Service actions
            actions: {
                getDevices: {
                    handler: this.getDevices.bind(this)
                },
                
                permitJoin: {
                    params: {
                        duration: { type: "number", optional: true, default: 60 }
                    },
                    handler: this.permitJoin.bind(this)
                },
                
                sendCommand: {
                    params: {
                        ieeeAddr: { type: "string", optional: true},
                        groupId: { type: "number", optional: true },
                        sceneId: { type: "number", optional: true },
                        clusterId: { type: "number" },
                        commandId: { type: "number" },
                        data: { type: "array", items: "number" }
                    },
                    handler: this.sendCommand.bind(this)
                }
            }
        });

        // Initialize device manager
        this.deviceManager = new DeviceManager(ZIGBEE_CONFIG.DEVICE_META_INFO_PATH, nodeId);
        
    }

    /**
     * Load network information from config file or create default
     * @returns Network information object
     */
    private getNetworkInfo() {
        let nwkInfo;
        try {
            if (fs.existsSync(ZIGBEE_CONFIG.ZIBGEE_NWK_INFO_PATH)) {
                nwkInfo = JSON.parse(fs.readFileSync(ZIGBEE_CONFIG.ZIBGEE_NWK_INFO_PATH, 'utf8'));
            }
        } catch (error:any) {
            this.logger.warn(`Error reading network info file: ${error.message}`);
        }
        
        if (!nwkInfo) {
            nwkInfo = {
                panID: Math.floor(Math.random() * 0xFFF0) + 1,
                channelList: [ZIGBEE_CONFIG.CHANNEL]
            };

            try {
                // Ensure directory exists
                const dirPath = ZIGBEE_CONFIG.ZIBGEE_NWK_INFO_PATH.substring(0, ZIGBEE_CONFIG.ZIBGEE_NWK_INFO_PATH.lastIndexOf('/'));
                if (dirPath && !fs.existsSync(dirPath)) {
                    fs.mkdirSync(dirPath, { recursive: true });
                }
                
                fs.writeFileSync(ZIGBEE_CONFIG.ZIBGEE_NWK_INFO_PATH, JSON.stringify(nwkInfo, null, 2));
            } catch (error:any) {
                this.logger.error(`Failed to create network info file: ${error.message}`);
            }
        }
        
        return nwkInfo;
    }

    /**
     * Service created lifecycle event handler
     */
    async serviceCreated() {
        this.logger.info('Zigbee Coordinator Service Created');

        // Get existing network info
        const nwkInfo = this.getNetworkInfo();
        
        // Initialize Zigbee coordinator
        this.coordinator = new ZigbeeCoordinatorDriver.Controller({
            network: nwkInfo,
            serialPort: { path: ZIGBEE_CONFIG.SERIAL_PORT },
            databasePath: ZIGBEE_CONFIG.DB_PATH,
            databaseBackupPath: ZIGBEE_CONFIG.DB_BACKUP_PATH,
            backupPath: ZIGBEE_CONFIG.ADAPTER_BACKUP_PATH,
            adapter: {disableLED: false},
            acceptJoiningDeviceHandler: async (ieeeAddr:string)=>{ return true }
        });
        
        // Setup event handlers
        this.coordinator.on('message', this.handleMessage.bind(this));
        this.coordinator.on('permitJoinChanged', this.handlePermitJoinChanged.bind(this));
        this.coordinator.on('deviceJoined', this.handleDeviceJoined.bind(this));
        this.coordinator.on('deviceInterview', this.handleDeviceInterview.bind(this));
    }

    /**
     * Service started lifecycle event handler
     */
    async serviceStarted() {
        this.logger.info("Zigbee Coordinator Service Started");
        
        try {
            if (!this.coordinator) {
                this.logger.error("Coordinator not initialized, cannot start service");
                return;
            }
            
            this.logger.info("Starting Zigbee coordinator...");
            await this.coordinator.start();
            this.logger.info(`Zigbee service started with device ${ZIGBEE_CONFIG.SERIAL_PORT}`);
            

        } catch (error) {
            this.logger.error("Failed to start Zigbee service:", error);
            throw error;
        }
    }

    /**
     * Service stopped lifecycle event handler
     */
    async serviceStopped() {
        this.logger.info("Zigbee Coordinator Service Stopped");
        
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
    }

    /**
     * Get all currently connected active devices
     */
    getDevices() {
        if (!this.coordinator) return [];
        const devices = [...this.coordinator.getDevicesIterator()].filter(
            (device: any) => device.type === 'Router' || device.type === 'EndDevice'
        );
        return devices;
    }

    /**
     * Toggle permit join status
     */
    async permitJoin(ctx: Moleculer.Context<PermitJoinParams>) {
        if (!this.coordinator) 
        {
            return { success: false, error: 'Coordinator not initialized' };
        }

        const duration = ctx.params.duration;
        await this.coordinator.permitJoin(duration);

        return { success: true, duration };
    }

    /**
     * Manually send a command to a device
     */
    async sendCommand(ctx: any) {
        const { ieeeAddr, clusterId, commandId, data } = ctx.params;
        if (ieeeAddr) {
            return await this.sendKeusAppUnicast(ieeeAddr, clusterId, commandId, data);
        } else {
            return { success: false, error: 'Currently not supported' };
        }
    }

    /**
     * Handle incoming Zigbee messages
     */
    handleMessage(msg: any) {
        this.logger.debug('Message received:', msg);
        //TODO: Handle non-keus messages
    }

    /**
     * Handle permit join status changes
     */
    handlePermitJoinChanged(msg: { permitted: boolean, time: number }) {
        if (msg.permitted) {
            this.logger.info(`Permit join enabled for ${msg.time} seconds`);
            this.broker.broadcast("zigbee.permitJoinChanged", { permitted: true, time: msg.time });
        } else {
            this.logger.info('Permit join disabled');
            this.broker.broadcast("zigbee.permitJoinChanged", { permitted: false });
        }
    }

    /**
     * Handle new device joining the network
     */
    handleDeviceJoined(device: any) {
        this.logger.info('New device joined: ', device.ieeeAddr);
    }

    /**
     * Handle device interview completion
     */
    async handleDeviceInterview(interview: any) {
        const device = interview.device;

        if (interview.status === 'successful') {
            this.logger.info('Device interview successful');

            if (device.isKeusDevice && device.manufacturerID === 0xAAAA) {
                this.logger.info('Identified as Keus custom device');
                
                // Get device details
                const endpoint = device.getEndpoint(ZIGBEE_CONFIG.KEUS_DEVICE_ENDPOINT);
                const deviceIdentifier = endpoint.deviceID;
                const { deviceType, deviceCategory } = this.deviceManager?.interpretDeviceIdentifier(deviceIdentifier) || { deviceType: 0, deviceCategory: 0 };
                const currentTimestamp = new Date().valueOf();
                
                // Look up device info from indexed metadata
                const deviceInfo = this.deviceManager?.getDeviceInfo(deviceType, deviceCategory);
                
                if (deviceInfo) {
                    this.logger.info("Device info:", {
                        timestamp: currentTimestamp,
                        category: deviceInfo.categoryDisplayName,
                        type: deviceInfo.typeDisplayName,
                        deviceType: deviceInfo.deviceType,
                        chipType: deviceInfo.chipType,
                        otaUpgradeable: deviceInfo.isOtaUpgradeable
                    });
                    
                    let deviceJoinEvent: DeviceJoinEvent = {
                        nodeId: this.deviceManager?.platformNodeID || '',
                        timestamp: currentTimestamp,
                        ieeeAddr: device.ieeeAddr,
                        deviceType: deviceInfo.deviceType,
                        deviceCategory: deviceInfo.deviceCategory,
                        deviceInfo: deviceInfo
                    }

                    // Emit event with device details
                    this.broker.sendToStream("p1.zigbee.parallel.events.device.join", deviceJoinEvent);
                } else {
                    this.logger.warn(`Unknown device category: ${deviceCategory}, type: ${deviceType}`);
                }
            } else {
                this.logger.info('Unknown zigbee device:', device.ieeeAddr);
            }
        } else if (interview.status === 'failed') {
            this.logger.warn('Device interview failed:', interview.device.ieeeAddr);
            this.logger.info('Removing device from network');
            device.removeFromNetwork();
        } else {
            this.logger.debug('Device interview status:', interview.status);
        }
    }

    /**
     * Send a command to a Keus device
     */
    async sendKeusAppUnicast(deviceId: string, clusterId: number, commandId: number, data: number[]) {
        try {
            if (!this.coordinator) {
                return {
                    success: false,
                    error: 'Coordinator not initialized'
                };
            }

            const device = this.coordinator.getDeviceByIeeeAddr(deviceId);

            if (!device) {
                return {
                    success: false,
                    error: 'Invalid Device'
                };
            }

            const endpoint = device.getEndpoint(ZIGBEE_CONFIG.KEUS_DEVICE_ENDPOINT);

            if (!endpoint) {
                return {
                    success: false,
                    error: 'Invalid Endpoint'
                };
            }

            const keusAppMsgRsp = await endpoint.command(
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
        } catch (err) {
            this.logger.error('Error sending Keus app unicast:', err);
            return { success: false, error: err };
        }
    }
}

export default ZigbeeCoordinatorService;