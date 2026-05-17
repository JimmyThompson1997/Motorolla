package com.pucky.device.tunnel;

import com.jcraft.jsch.Proxy;
import com.jcraft.jsch.SocketFactory;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Collections;

import javax.net.ssl.SNIHostName;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

final class TlsSniProxy implements Proxy {
    private final String serverName;
    private Socket socket;
    private InputStream inputStream;
    private OutputStream outputStream;

    TlsSniProxy(String serverName) {
        this.serverName = serverName == null ? "" : serverName.trim();
    }

    @Override
    public void connect(SocketFactory socketFactory, String host, int port, int timeout) throws Exception {
        Socket raw = new Socket();
        raw.connect(new InetSocketAddress(host, port), timeout);
        raw.setSoTimeout(timeout);

        SSLSocketFactory factory = (SSLSocketFactory) SSLSocketFactory.getDefault();
        SSLSocket tls = (SSLSocket) factory.createSocket(raw, host, port, true);
        SSLParameters parameters = tls.getSSLParameters();
        String sni = serverName.isEmpty() ? host : serverName;
        parameters.setServerNames(Collections.singletonList(new SNIHostName(sni)));
        parameters.setEndpointIdentificationAlgorithm("HTTPS");
        tls.setSSLParameters(parameters);
        tls.startHandshake();
        socket = tls;
        inputStream = tls.getInputStream();
        outputStream = tls.getOutputStream();
    }

    @Override
    public InputStream getInputStream() {
        return inputStream;
    }

    @Override
    public OutputStream getOutputStream() {
        return outputStream;
    }

    @Override
    public Socket getSocket() {
        return socket;
    }

    @Override
    public void close() {
        if (socket == null) {
            return;
        }
        try {
            socket.close();
        } catch (Exception ignored) {
            // Best effort proxy teardown.
        }
    }
}
