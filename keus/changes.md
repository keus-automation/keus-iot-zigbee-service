//TODO
✔ keus device add
✔ keus device remove and force remove

adapter.ts: No need of adapter discover in 
zStackAdapter.ts: supports LED is false 
?? getOptionsWithDefaults - manufacturer code = null ?
?? deviceVersion from simpledescriptor required ?
?? group.ts commandStandalone required ?
?? logs disabling required? 
?? index exports
?? controller/index exports


lets handle rejoin as joined and check for existing entries
mongodb shouldn't need zigbee nwk information like shortaddr


panId needs to be saved in zigbee_info.json
✔ add backup path
remove greenpower support
✔ confirm backup interval
!! why is db saving every hour
force manual backup
add offline device
    ZDSecMgrAddrStore
    ZDSecMgrAddLinkKey - seems to do everything required

    MT_UTIL_ADDRMGR_NWK_ADDR_LOOKUP
    MT_ZDO_SEC_ADD_LINK_KEY
        
force remove device