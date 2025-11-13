include build/make/target/board/BoardConfigMainlineCommon.mk
include build/make/target/board/BoardConfigPixelCommon.mk

TARGET_ARCH := arm64
TARGET_ARCH_VARIANT := armv8-2a-dotprod
TARGET_CPU_ABI := arm64-v8a
TARGET_CPU_VARIANT := cortex-a76

TARGET_2ND_ARCH := arm
TARGET_2ND_ARCH_VARIANT := armv8-2a
TARGET_2ND_CPU_ABI := armeabi-v7a
TARGET_2ND_CPU_ABI2 := armeabi
TARGET_2ND_CPU_VARIANT := cortex-a76
TARGET_2ND_CPU_VARIANT_RUNTIME := cortex-a76

include vendor/adevtool/config/mk/google_devices/common/BoardConfig-common.mk

BOARD_GOOGLE_DYNAMIC_PARTITIONS_PARTITION_LIST := \
    system \
    system_ext \
    product \
    vendor \
    vendor_dlkm

# Set error limit to BOARD_SUPER_PARTITON_SIZE - 400MB
BOARD_SUPER_PARTITION_ERROR_LIMIT := 8111783936

# Testing related defines
BOARD_PERFSETUP_SCRIPT := platform_testing/scripts/perf-setup/r4o6-setup.sh

BOARD_VENDOR_RAMDISK_FRAGMENTS := dlkm
BOARD_VENDOR_RAMDISK_FRAGMENT.dlkm.KERNEL_MODULE_DIRS := top

BOARD_AVB_ENABLE := true
BOARD_BOOTIMAGE_PARTITION_SIZE := 0x04000000
BOARD_VENDOR_BOOTIMAGE_PARTITION_SIZE := 0x04000000
BOARD_DTBOIMG_PARTITION_SIZE := 0x01000000

# Prebuilt kernel modules that are *not* listed in vendor_boot.modules.load
BOARD_VENDOR_RAMDISK_KERNEL_MODULES_LOAD_EXTRA = $(foreach k,$(BOARD_PREBUILT_VENDOR_RAMDISK_KERNEL_MODULES),$(if $(wildcard $(KERNEL_MODULE_DIR)/$(k)), $(k)))

# Kernel modules that are listed in vendor_boot.modules.load

BOARD_VENDOR_RAMDISK_KERNEL_MODULES_LOAD_FILE := $(strip $(shell cat $(KERNEL_MODULE_DIR)/modules.load))

ifndef BOARD_VENDOR_RAMDISK_KERNEL_MODULES_LOAD_FILE
$(error vendor_boot.modules.load not found or empty)
endif
BOARD_VENDOR_RAMDISK_KERNEL_MODULES_LOAD := $(BOARD_VENDOR_RAMDISK_KERNEL_MODULES_LOAD_EXTRA)
BOARD_VENDOR_RAMDISK_KERNEL_MODULES_LOAD += $(BOARD_VENDOR_RAMDISK_KERNEL_MODULES_LOAD_FILE)
BOARD_VENDOR_RAMDISK_KERNEL_MODULES := $(addprefix $(KERNEL_MODULE_DIR)/, $(BOARD_VENDOR_RAMDISK_KERNEL_MODULES_LOAD_EXTRA))
BOARD_VENDOR_RAMDISK_KERNEL_MODULES += $(addprefix $(KERNEL_MODULE_DIR)/, $(notdir $(BOARD_VENDOR_RAMDISK_KERNEL_MODULES_LOAD_FILE)))

BOARD_VENDOR_KERNEL_MODULES_LOAD += $(strip $(shell cat $(KERNEL_MODULE_DIR)/vendor_dlkm.modules.load))
ifndef BOARD_VENDOR_KERNEL_MODULES_LOAD
$(error vendor_dlkm.modules.load not found or empty)
endif
BOARD_VENDOR_KERNEL_MODULES += $(KERNEL_MODULES)

AB_OTA_PARTITIONS += pvmfw
