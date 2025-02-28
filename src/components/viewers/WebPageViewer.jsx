import { useEffect, useRef, useState } from "react";
import { useUser } from "../../context/Usercontext";

// Fetch userId from localStorage and sessionStorage
const localStorageUserId = localStorage.getItem("userId");
const sessionStorageUserId = sessionStorage.getItem("userId");

const getMimeType = (mimeType) => {
  console.log(mimeType, "type of mime");
  if (mimeType === "weblink") {
    return mimeType;
  }
  return "weblink";
};

// Function to call the existUser API
const callExistUserAPI = async (userId, mimeType) => {
  try {
    const cleanedMimeType = getMimeType(mimeType);
    const response = await fetch("http://localhost:8000/api/test2/existUser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, mimeType: cleanedMimeType }),
    });
    if (!response.ok) throw new Error("Failed to call existUser API");
    console.log("existUser API called successfully");
  } catch (error) {
    console.error("Error calling existUser API:", error);
  }
};

// Function to call the newUser API
const callNewUserAPI = async (userId, mimeType) => {
  try {
    const cleanedMimeType = getMimeType(mimeType);
    const response = await fetch("http://localhost:8000/api/test1/newUser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, mimeType: cleanedMimeType }),
    });
    if (!response.ok) throw new Error("Failed to call newUser API");
    console.log("newUser API called successfully");
  } catch (error) {
    console.error("Error calling newUser API:", error);
  }
};

const WebPageViewer = ({ url, mimeType }) => {
  const { ip, location, userId, region, os, device, browser } = useUser();
  const heatmapData = useRef(new Map());
  const currentPos = useRef(null);
  const lastUpdate = useRef(Date.now());
  const gridSize = 20;

  // Track entry and exit times
  const [inTime] = useState(new Date().toISOString());
  const [outTime, setOutTime] = useState(null);

  // Track if user data is loaded
  const [isUserDataLoaded, setIsUserDataLoaded] = useState(false);

  // Prevent multiple API calls for exist/new user
  const apiCalledRef = useRef(false);

  // Prevent multiple analytics data submissions
  const analyticsSentRef = useRef(false);

  // Monitor when user data is fully available
  useEffect(() => {
    if (
      ip !== "Detecting..." &&
      location !== "Detecting..." &&
      userId !== "Generating..." &&
      region !== "Detecting..." &&
      os !== "Detecting..." &&
      device !== "Detecting..." &&
      browser !== "Detecting..."
    ) {
      setIsUserDataLoaded(true);
    }
  }, [ip, location, userId, region, os, device, browser]);

  // Logic to handle userId from localStorage and sessionStorage
  useEffect(() => {
    if (apiCalledRef.current) return; // Prevent multiple API calls

    const delay = 2000; // 2-second delay

    const timer = setTimeout(() => {
      // Check if all required context data is ready
      const isDataReady =
        ip &&
        location &&
        userId &&
        region &&
        os &&
        device &&
        browser &&
        !ip.includes("Detecting") &&
        !location.includes("Detecting") &&
        !userId.includes("Detecting") &&
        !region.includes("Detecting") &&
        !os.includes("Detecting") &&
        !device.includes("Detecting") &&
        !browser.includes("Detecting");

      if (
        localStorageUserId &&
        sessionStorageUserId &&
        localStorageUserId === sessionStorageUserId
      ) {
        callExistUserAPI(localStorageUserId, mimeType);
        apiCalledRef.current = true;
      } else if (!localStorageUserId && !sessionStorageUserId) {
        if (isDataReady && userId) {
          callNewUserAPI(userId, mimeType);
          apiCalledRef.current = true;
        }
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [
    localStorageUserId,
    sessionStorageUserId,
    userId,
    ip,
    location,
    region,
    os,
    device,
    browser,
    mimeType,
  ]);

  // Function to send analytics data instantly when the tab is closed
  const sendAnalyticsData = async () => {
    if (!isUserDataLoaded || analyticsSentRef.current) return; // Ensure data is ready and not sent already

    analyticsSentRef.current = true; // Mark as sent

    const exitTime = new Date();
    setOutTime(exitTime.toISOString());

    const totalTimeSpent = Math.floor((exitTime - new Date(inTime)) / 1000);

    // Process heatmap data, filtering out time spent <= 5 seconds
    const filteredHeatmap = Array.from(heatmapData.current.entries())
      .map(([position, time]) => ({
        position,
        timeSpent: Math.floor(time / 1000),
      }))
      .filter(({ timeSpent }) => timeSpent > 5);

    const payload = {
      ip,
      location,
      userId,
      region,
      os,
      device,
      browser,
      webId: window.location.pathname.split("/").pop() || "",
      sourceUrl: url,
      inTime,
      outTime: exitTime.toISOString(),
      totalTimeSpent,
      pointerHeatmap: filteredHeatmap,
    };

    if (filteredHeatmap.length > 0) {
      try {
        // Use normal fetch API call instead of sendBeacon
        const response = await fetch(
          "http://localhost:8000/api/v1/webpageinteraction/analytics",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          }
        );

        if (response.ok) {
          console.log("Analytics data sent successfully.");
        } else {
          console.error("Failed to send analytics data:", response.status);
        }
      } catch (error) {
        console.error("Error sending analytics data:", error);
      }
    } else {
      console.log("No significant movement detected, skipping API call.");
    }
  };

  // Attach a beforeunload event to trigger the default browser leave modal
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      sendAnalyticsData();  // Call analytics data when the page is about to unload
      e.preventDefault();
      e.returnValue = "Are you sure you want to leave?"; // Browser's native message
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        sendAnalyticsData();  // Call analytics data when tab visibility changes
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isUserDataLoaded]);

  // Handle pointer movement messages
  useEffect(() => {
    const handleMessage = (event) => {
      if (!event.data || typeof event.data.x !== "number" || typeof event.data.y !== "number") {
        return;
      }

      const { x, y } = event.data;
      const gridX = Math.floor((x + gridSize / 2) / gridSize) * gridSize;
      const gridY = Math.floor(y / gridSize) * gridSize;
      const positionKey = `${gridX},${gridY}`;
      const now = Date.now();

      if (currentPos.current) {
        const elapsed = now - lastUpdate.current;
        const prevKey = `${currentPos.current.x},${currentPos.current.y}`;
        if (!isNaN(elapsed) && elapsed > 0) {
          heatmapData.current.set(
            prevKey,
            (heatmapData.current.get(prevKey) || 0) + elapsed
          );
        }
      }

      currentPos.current = { x: gridX, y: gridY };
      lastUpdate.current = now;

      if (!heatmapData.current.has(positionKey)) {
        heatmapData.current.set(positionKey, 0);
      }

      // Log the pointer data to console for every movement
      console.log("Pointer Data: ", { x, y, gridX, gridY });
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [url, isUserDataLoaded]);

  return (
    <>
      <iframe
        src={url}
        style={{ width: "100%", height: "100vh", border: "none" }}
        title="WebPageViewer"
      />
    </>
  );
};

export default WebPageViewer;
