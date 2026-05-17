package com.pucky.device.command;

public final class CommandException extends Exception {
    private final String code;

    public CommandException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
