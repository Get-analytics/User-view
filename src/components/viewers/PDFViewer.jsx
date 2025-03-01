import React, { useEffect, useState, useRef, useCallback } from "react";
import { Worker, Viewer } from "@react-pdf-viewer/core";
import "@react-pdf-viewer/core/lib/styles/index.css";
import { useUser } from "../../context/Usercontext";

const MyPdfViewer = ({ url, mimeType }) => {
  console.log(mimeType, "mimetype");

  const { ip, location, userId, region, os, device, browser } = useUser(); // Extract context values
  console.log(ip, location, userId, region, os, device, browser, "dataaaaaaa");
  console.log(window.location.pathname);
  console.log(userId, "userid");

  const [pdfjs, setPdfjs] = useState(null);
  const [pdfjsWorker, setPdfjsWorker] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const timeSpentRef = useRef({});
  const pageTimerRef = useRef(null);
  const visitedPagesRef = useRef(new Set());
  const milestoneVisitedPagesRef = useRef(0);
  const [totalClicks, setTotalClicks] = useState(0);
  const [selectedTexts, setSelectedTexts] = useState([]); // Array to store selected texts
  const [linkClicks, setLinkClicks] = useState([]); // Array to store link clicks
  const [pageVisitCount, setPageVisitCount] = useState({}); // Track page visits
  const scrollPercentageRef = useRef(0);
  const leaveConfirmationRef = useRef(false); // To prevent multiple triggers
  const apiCalledRef = useRef(false); // To track if API has been called

  const fileUrl = url;

  // Initialize analyticsData with context values
  const [analyticsData, setAnalyticsData] = useState({
    ip: ip || "",
    location: location || "",
    userId: userId || "",
    region: region || "",
    os: os || "",
    device: device || "",
    browser: browser || "",
    pdfId: window.location.pathname.split("/").pop() || "",
    sourceUrl: url,
    totalPagesVisited: 0,
    totalTimeSpent: 0,
    pageTimeSpent: {},
    selectedTexts: [], // Array to store selected texts with count and page
    totalClicks: 0,
    inTime: new Date().toISOString(), // Login time in ISO format
    outTime: null, // Logout time will be set when the user leaves
    mostVisitedPage: null, // Most visited page will be set later
    linkClicks: [], // Array to store link clicks
    totalPages: 0, // Add totalPages field
  });

  // Fetch userId from localStorage and sessionStorage
  const localStorageUserId = localStorage.getItem("userId");
  const sessionStorageUserId = sessionStorage.getItem("userId");

  // Function to extract the last part of the MIME type (e.g., "pdf" from "application/pdf")
  // If mimeType is empty, return "unknown"
  const getMimeType = (mimeType) => {
    console.log(mimeType, "type of mime");
    return mimeType && mimeType.includes("/") ? mimeType.split("/").pop() : "unknown";
  };

  // Function to call the existUser API
  const callExistUserAPI = async (userId, mimeType) => {
    try {
      const cleanedMimeType = getMimeType(mimeType);
      const response = await fetch("https://filescene.onrender.com/api/test2/existUser", {
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
      const response = await fetch("https://filescene.onrender.com/api/test1/newUser", {
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

  // Logic to handle userId from localStorage and sessionStorage
  useEffect(() => {
    if (apiCalledRef.current) return; // Prevent multiple API calls

    const delay = 1000; // 1-second delay

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

      if (localStorageUserId && sessionStorageUserId && localStorageUserId === sessionStorageUserId) {
        // Both values exist and are the same
        callExistUserAPI(localStorageUserId, mimeType);
        apiCalledRef.current = true; // Mark API as called
      } else if (!localStorageUserId && !sessionStorageUserId) {
        // Both values are empty
        if (isDataReady && userId) {
          callNewUserAPI(userId, mimeType); // Use userId from useUser context
          apiCalledRef.current = true; // Mark API as called
        }
      }
    }, delay);

    // Cleanup the timer if the component unmounts or dependencies change
    return () => clearTimeout(timer);
  }, [localStorageUserId, sessionStorageUserId, userId, ip, location, region, os, device, browser]);

  // Update analyticsData when context values change
  useEffect(() => {
    setAnalyticsData((prevData) => ({
      ...prevData,
      ip: ip || "",
      location: location || "",
      userId: userId || "",
      region: region || "",
      os: os || "",
      device: device || "",
      browser: browser || "",
    }));
  }, [ip, location, userId, region, os, device, browser]);

  useEffect(() => {
    const loadPdfjs = async () => {
      const pdfjsModule = await import("pdfjs-dist/build/pdf");
      const pdfjsWorkerModule = await import("pdfjs-dist/build/pdf.worker.entry");
      pdfjsModule.GlobalWorkerOptions.workerSrc = pdfjsWorkerModule;
      setPdfjs(pdfjsModule);
      setPdfjsWorker(pdfjsWorkerModule);
    };

    loadPdfjs();
  }, []);

  const handlePageChange = useCallback(
    (e) => {
      const newPage = e.currentPage + 1; // Get the new page number
      clearInterval(pageTimerRef.current);

      // Initialize the time spent for the new page if it's not already tracked
      if (!timeSpentRef.current[newPage]) {
        timeSpentRef.current[newPage] = 0;
      }

      // Start a timer to track the time spent on the page
      pageTimerRef.current = setInterval(() => {
        timeSpentRef.current[newPage] += 1;
        setAnalyticsData((prevData) => ({
          ...prevData,
          totalTimeSpent: prevData.totalTimeSpent + 1,
          pageTimeSpent: {
            ...prevData.pageTimeSpent,
            [newPage]: (prevData.pageTimeSpent[newPage] || 0) + 1,
          },
        }));
      }, 1000);

      visitedPagesRef.current.add(newPage);
      const visitedPagesCount = visitedPagesRef.current.size;

      if (visitedPagesCount >= milestoneVisitedPagesRef.current + 10) {
        milestoneVisitedPagesRef.current = Math.floor(visitedPagesCount / 10) * 10;
        console.log(`Visited Pages Milestone: ${milestoneVisitedPagesRef.current} pages visited.`);
      }

      setAnalyticsData((prevData) => ({
        ...prevData,
        totalPagesVisited: visitedPagesCount,
      }));

      // Track page visit count and calculate most visited page by time spent
      setPageVisitCount((prevCount) => {
        const newCount = { ...prevCount, [newPage]: (prevCount[newPage] || 0) + 1 };

        // Calculate the most visited page by time spent
        let mostVisitedPage = null;
        let maxTimeSpent = 0;
        for (const [page, time] of Object.entries(timeSpentRef.current)) {
          if (time > maxTimeSpent) {
            mostVisitedPage = page;
            maxTimeSpent = time;
          }
        }

        setAnalyticsData((prevData) => ({
          ...prevData,
          mostVisitedPage: mostVisitedPage, // Set the most visited page based on time spent
        }));

        return newCount;
      });

      setCurrentPage(newPage);
    },
    [setAnalyticsData]
  );

  const handleTextSelection = useCallback(() => {
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
      const truncatedText = selectedText.length > 300 ? selectedText.slice(0, 300) : selectedText;

      console.log(`Selected Text on page ${currentPage}: "${truncatedText}"`);

      // Update selectedTexts array
      setSelectedTexts((prevSelectedTexts) => {
        const existingText = prevSelectedTexts.find((item) => item.selectedText === truncatedText && item.page === currentPage);

        if (existingText) {
          // If the text already exists, increment the count
          return prevSelectedTexts.map((item) =>
            item.selectedText === truncatedText && item.page === currentPage
              ? { ...item, count: item.count + 1 }
              : item
          );
        } else {
          // If the text is new, add it to the array with the current page
          return [...prevSelectedTexts, { selectedText: truncatedText, count: 1, page: currentPage }];
        }
      });
    }
  }, [currentPage]);

  const handleLinkClick = useCallback((e) => {
    const linkElement = e.target.closest("a");
    if (linkElement) {
      e.preventDefault(); // Prevent default link behavior
      const linkUrl = linkElement.href;
      console.log(`Link clicked on page ${currentPage}: ${linkUrl}`);

      // Open the link in a new tab
      window.open(linkUrl, "_blank");

      // Track the link click
      setLinkClicks((prevLinkClicks) => [
        ...prevLinkClicks,
        { page: currentPage, clickedLink: linkUrl },
      ]);
    }
  }, [currentPage]);

  const handleClick = useCallback((e) => {
    setTotalClicks((prev) => prev + 1);
  }, []);

  const sendAnalyticsData = async () => {
    const finalData = {
      ...analyticsData,
      outTime: new Date().toISOString(), // Logout time in ISO format
      userId: userId,
      selectedTexts: selectedTexts, // Include selected texts array
      totalClicks: totalClicks,
      linkClicks: linkClicks, // Include link clicks array
    };

    try {
      const response = await fetch("https://filescene.onrender.com/api/PdfInfo/pdfpageinfo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalData),
      });

      if (!response.ok) {
        throw new Error("Network response was not ok");
      }

      const result = await response.json();
      console.log("Data sent successfully:", result);
    } catch (error) {
      console.error("Error sending analytics data:", error);
    }
  };

  const handleBeforeUnload = (e) => {
    if (leaveConfirmationRef.current) return;

    leaveConfirmationRef.current = true;
    e.preventDefault();
    e.returnValue = "Are you sure you want to leave? Data will be sent to the server.";

    // Send analytics data
    sendAnalyticsData();

    // Close the page after a 2-second delay
    setTimeout(() => {
      window.close(); // This will only work if the page was opened via JavaScript (window.open).
    }, 2000);  // 2-second delay
  };

  const handlePopState = () => {
    if (leaveConfirmationRef.current) return;

    leaveConfirmationRef.current = true;
    const confirmation = window.confirm("Are you sure you want to leave? Data will be sent to the server.");

    if (confirmation) {
      // Send analytics data
      sendAnalyticsData();

      // Close the page after a 2-second delay
      setTimeout(() => {
        window.close(); // This will only work if the page was opened via JavaScript.
      }, 5000);  // 5-second delay
    }
  };

  // Mobile device: send analytics data every 5 seconds
  useEffect(() => {
   
      const interval = setInterval(() => {
        sendAnalyticsData();
      }, 5000);

      return () => clearInterval(interval);
    
  }, [device, analyticsData, selectedTexts, totalClicks, linkClicks]);

  useEffect(() => {
    document.addEventListener("mouseup", handleTextSelection);
    document.addEventListener("click", handleClick);
    document.addEventListener("click", handleLinkClick); // Add listener for link clicks
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);

    return () => {
      document.removeEventListener("mouseup", handleTextSelection);
      document.removeEventListener("click", handleClick);
      document.removeEventListener("click", handleLinkClick); // Remove listener for link clicks
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [handleTextSelection, handleClick, handleLinkClick]);

  if (!pdfjs || !pdfjsWorker) {
    return <div>Loading...</div>;
  }

  return (
    <div style={{ height: "100vh", position: "relative" }}>
      <h1 style={{ textAlign: "center", padding: "20px" }}>PDF Viewer</h1>
      <Worker workerUrl={pdfjsWorker}>
        <Viewer
          fileUrl={fileUrl}
          defaultScale={1.5}
          renderMode="canvas"
          onPageChange={handlePageChange}
          plugins={[]}
        />
      </Worker>
    </div>
  );
};

export default MyPdfViewer;
