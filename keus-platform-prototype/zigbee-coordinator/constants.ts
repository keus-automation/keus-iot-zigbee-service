/**
 * Constants for Zigbee Coordinator Service
 */
// Zigbee Configuration
const KEUS_ZIGBEE_ENDPOINT = 15;
const ZIGBEE_SERIAL_PORT = 'COM20';
const ZIGBEE_CHANNEL = 15;

export const ZIGBEE_CONFIG = {
    SERIAL_PORT: ZIGBEE_SERIAL_PORT,
    DB_PATH: '.zigbee_data/devices.db',
    ZIBGEE_NWK_INFO_PATH: '.zigbee_data/zigbee_nwk_info.json',
    DB_BACKUP_PATH: '.zigbee_data/devices.db.backup',
    ADAPTER_BACKUP_PATH: '.zigbee_data/adapter.backup',
    KEUS_DEVICE_ENDPOINT: KEUS_ZIGBEE_ENDPOINT,
    KEUS_MASTER_ENDPOINT: KEUS_ZIGBEE_ENDPOINT,
    DEVICE_META_INFO_PATH: 'keus-platform-prototype/zigbee-coordinator/device_meta_info.json',
    CHANNEL: ZIGBEE_CHANNEL
};

// Standard request options for Keus unicast messages
export const GENERAL_UNICAST_REQ_OPTIONS = {
    disableDefaultResponse: true,
    response: true,
    timeout: 10000,
    srcEndpoint: ZIGBEE_CONFIG.KEUS_MASTER_ENDPOINT
};

// Service Node ID
export const NODE_ID = "zcs"; 