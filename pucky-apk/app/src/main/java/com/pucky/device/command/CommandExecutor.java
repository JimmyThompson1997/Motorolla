package com.pucky.device.command;

import org.json.JSONObject;

public interface CommandExecutor {
    JSONObject execute(CommandEnvelope command) throws CommandException;
}
