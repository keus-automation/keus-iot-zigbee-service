
import { KEUS_DEVICE_METADATA } from "../constants/keusDeviceMetadata";

const KEUS_ENDPOINT = 15;
const DEFAULT_ENDPOINT = 1;

export enum KeusManufacturers {
    KEUS = 0xaaaa,
    DOOR_SENSOR = 0x1228,
    YALE = 0x101d
}

export const KEUS_SUPPORTED_ENDPOINTS: {[key:number]: {endpoint: number}} = {
    [KeusManufacturers.KEUS]: {
        endpoint: KEUS_ENDPOINT,
    },
    [KeusManufacturers.DOOR_SENSOR]: {
        endpoint: DEFAULT_ENDPOINT,
    },
    [KeusManufacturers.YALE]: {
        endpoint: DEFAULT_ENDPOINT,
    },
}

export interface IKeusDeviceMetadata {
    deviceType: number;
    deviceCategory: number;
    deviceTypeCode?: string;
    deviceCategoryCode?: string;
    endpointId: number;
    manufacturerCode: number;
    additionalInfo? : any;
}

export { KEUS_DEVICE_METADATA }
