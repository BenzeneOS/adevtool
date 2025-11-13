TARGET_BOARD_PLATFORM := gs101

include vendor/adevtool/config/mk/google_devices/common/device-common.mk

PRODUCT_SOONG_NAMESPACES += vendor/adevtool/config/mk/google_devices/platform/gs101

PRODUCT_PACKAGES += GosOverlay

PRODUCT_PACKAGES += init.gs101.grapheneos.rc

DEVICE_PACKAGE_OVERLAYS += \
	vendor/adevtool/config/mk/google_devices/platform/gs101/overlay-excluded-from-enforce-rro-targets

PRODUCT_ENFORCE_RRO_EXCLUDED_OVERLAYS += \
	vendor/adevtool/config/mk/google_devices/platform/gs101/overlay-excluded-from-enforce-rro-targets

$(call inherit-product, $(SRC_TARGET_DIR)/product/virtual_ab_ota/compression_with_xor.mk)
$(call inherit-product, $(SRC_TARGET_DIR)/product/core_64_bit.mk)

$(call soong_config_set,android_hardware_audio,run_64bit,true)
