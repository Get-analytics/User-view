import React, { createContext, useContext, useEffect, useState } from "react";
import axios from "axios";
import { UAParser } from "ua-parser-js";

const UserContext = createContext();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getDeviceInfo = () => {
  const parser = new UAParser();
  const { os, browser, device } = parser.getResult();

  return {
    os: os.name || navigator.platform || "Unknown OS",
    deviceType: device.type || (navigator.userAgent.match(/mobile/i) ? "Mobile" : "Desktop"),
    browser: browser.name || "Unknown Browser",
    deviceVendor: device.vendor || "Unknown Vendor",
    cpuArch: os.architecture || "Unknown Arch",
    screenSize: `${window.screen.width}x${window.screen.height}`,
  };
};

const fetchIP = async () => {
  try {
    const res = await Promise.any([
      axios.get("https://api.ipify.org?format=json"),
      axios.get("https://ipapi.co/json"),
      axios.get("https://ip.seeip.org/json"),
    ]);
    return res.data.ip;
  } catch {
    return "Unknown IP";
  }
};

const fetchGeoData = async (ip) => {
  try {
    const { data } = await axios.get(`https://ipinfo.io/${ip}/json?token=6b3b02e2f43d33`);
    return {
      city: data.city || "Unknown City",
      region: data.region || data.country || "Unknown Region",
      loc: data.loc || "0,0",
      country: data.country || "XX",
    };
  } catch {
    return {
      city: "Unknown City",
      region: "Unknown Region",
      loc: "0,0",
      country: "XX",
    };
  }
};

const generateUserHash = async (deviceInfo, ip) => {
  const dataString = `${deviceInfo.os}-${deviceInfo.cpuArch}-${deviceInfo.deviceVendor}-${deviceInfo.screenSize}-${ip}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(dataString);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const UserProvider = ({ children }) => {
  const [userInfo, setUserInfo] = useState({
    ip: "Detecting...",
    location: "Detecting...",
    userId: "Generating...",
    region: "Detecting...",
    os: "Detecting...",
    device: "Detecting...",
    browser: "Detecting...",
  });

  useEffect(() => {
    const initializeUser = async () => {
      try {
        const deviceInfo = getDeviceInfo();
        const storedUserId = localStorage.getItem("userId") || sessionStorage.getItem("userId");
        const ip = await fetchIP();
        const geoData = await fetchGeoData(ip);
        
        const userId = storedUserId || (await generateUserHash(deviceInfo, ip));
        
        const finalUser = {
          userId,
          ip,
          os: deviceInfo.os,
          device: deviceInfo.deviceType,
          browser: deviceInfo.browser,
          region: geoData.region,
          location: `${geoData.city}, ${geoData.country}`,
          coordinates: geoData.loc,
          vendor: deviceInfo.deviceVendor,
          architecture: deviceInfo.cpuArch,
        };

        setUserInfo(finalUser);
        
        setTimeout(() => {
          localStorage.setItem("userId", userId);
          sessionStorage.setItem("userId", userId);
          console.log("User ID stored in localStorage and sessionStorage.");
        }, 3000);
      } catch (error) {
        console.error("User detection error:", error);
        if (error.response?.status === 429) {
          await delay(120000);
          initializeUser();
        }
      }
    };

    initializeUser();
  }, []);

  return <UserContext.Provider value={userInfo}>{children}</UserContext.Provider>;
};

export const useUser = () => useContext(UserContext);
