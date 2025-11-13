TARGET_BOARD_PLATFORM := gs201

include vendor/adevtool/config/mk/google_devices/common/device-common-gs201-plus.mk

PRODUCT_SOONG_NAMESPACES += vendor/adevtool/config/mk/google_devices/platform/gs201

PRODUCT_PACKAGES += GosOverlay

PRODUCT_PACKAGES += init.gs201.grapheneos.rc

