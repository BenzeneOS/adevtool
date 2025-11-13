TARGET_ARCH := arm64
TARGET_ARCH_VARIANT := armv9-a
TARGET_CPU_ABI := arm64-v8a
TARGET_CPU_VARIANT := cortex-a76
TARGET_HAS_ARM_MTE := true

BOARD_KERNEL_CMDLINE += bootloader.pixel.MTE_FORCE_ON

# enable synchronous kernel MTE
BOARD_KERNEL_CMDLINE += kasan.fault=panic

# enable heap memory tagging by default for all non-prebuilt binaries
ifeq ($(filter memtag_heap,$(SANITIZE_TARGET)),)
SANITIZE_TARGET := $(strip $(SANITIZE_TARGET) memtag_heap)
endif
