package com.pucky.device.command;

public final class CommandErrorCodes {
    public static final String MALFORMED_COMMAND = "MALFORMED_COMMAND";
    public static final String COMMAND_NOT_ALLOWED = "COMMAND_NOT_ALLOWED";
    public static final String COMMAND_EXPIRED = "COMMAND_EXPIRED";
    public static final String PERMISSION_MISSING = "PERMISSION_MISSING";
    public static final String CAPABILITY_UNAVAILABLE = "CAPABILITY_UNAVAILABLE";
    public static final String EXECUTION_FAILED = "EXECUTION_FAILED";

    private CommandErrorCodes() {
    }
}
