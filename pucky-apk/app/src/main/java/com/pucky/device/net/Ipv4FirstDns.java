package com.pucky.device.net;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import okhttp3.Dns;

public final class Ipv4FirstDns implements Dns {
    public static final Ipv4FirstDns INSTANCE = new Ipv4FirstDns();

    private Ipv4FirstDns() {
    }

    @Override
    public List<InetAddress> lookup(String hostname) throws UnknownHostException {
        if (hostname == null || hostname.trim().isEmpty()) {
            throw new UnknownHostException("hostname is empty");
        }
        List<InetAddress> addresses = new ArrayList<>();
        Collections.addAll(addresses, InetAddress.getAllByName(hostname));
        addresses.sort((left, right) -> {
            boolean leftV4 = left instanceof Inet4Address;
            boolean rightV4 = right instanceof Inet4Address;
            if (leftV4 == rightV4) {
                return 0;
            }
            return leftV4 ? -1 : 1;
        });
        return addresses;
    }
}
