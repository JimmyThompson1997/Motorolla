package com.pucky.device;

/**
 * Dedicated activity component for the outer-display home task.
 *
 * Keeping this separate from the normal launcher entry prevents Android from
 * restoring a phone-sized launcher task into the cover display after wake.
 */
public final class CoverHomeActivity extends MainActivity {
}
