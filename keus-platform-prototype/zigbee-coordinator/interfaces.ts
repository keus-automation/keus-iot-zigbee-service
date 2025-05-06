/**
 * Type definitions for Zigbee Coordinator Service
 */

export interface DeviceMetaInfoByCategory {
    [categoryId: number]: {
        [typeId: number]: any;
    };
}

export interface DeviceIdentifier {
    deviceType: number;
    deviceCategory: number;
}

// Action Parameters
export interface PermitJoinParams {
    duration: number;
}

export interface SendCommandParams {
    ieeeAddr?: string;
    groupId?: number;
    sceneId?: number;
    clusterId: number;
    commandId: number;
    data: number[];
}

// Response Types
export interface CommandResponse {
    success: boolean;
    rsp?: any;
    error?: any;
}

export interface PermitJoinResponse {
    success: boolean;
    duration?: number;
    error?: string;
}

// Event Types
export interface DeviceJoinEvent {
    nodeId: string;
    timestamp: number;
    ieeeAddr: string;
    deviceType: number;
    deviceCategory: number;
    deviceInfo: any;
}