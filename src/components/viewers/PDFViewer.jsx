import React, {
  useEffect,
  useState,
  useRef,
  useCallback
} from "react";
import { Worker, Viewer } from "@react-pdf-viewer/core";
import "@react-pdf-viewer/core/lib/styles/index.css";
import { useUser } from "../../context/Usercontext";

/* =============================================================================
   HELPER FUNCTIONS
============================================================================= */

// Simple throttle helper to limit execution frequency (for mobile events)
const throttle = (func, delay) => {
  let lastCall = 0;
  return (...args) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      func(...args);
    }
  };
};

// Simple debounce helper to execute a function after a delay only if no new call occurs
const debounce = (func, delay) => {
  let timerId;
  return (...args) => {
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(() => {
      func(...args);
      timerId = null;
    }, delay);
  };
};

// Check for mobile device using user agent and touch support
const checkIsMobile = () => {
  return /Mobi|Android/i.test(navigator.userAgent) || ("ontouchstart" in window);
};

/* =============================================================================
   MAIN COMPONENT
============================================================================= */

const MyPdfViewer = ({ url, mimeType }) => {
  // Get user context values
  const { ip, location, userId, region, os, device, browser } = useUser();

  // Determine device type and store it in state (mobile vs. desktop)
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    setIsMobile(checkIsMobile());
  }, []);

  // State for pdfjs and its worker
  const [pdfjs, setPdfjs] = useState(null);
  const [pdfjsWorker, setPdfjsWorker] = useState(null);
  
  // State to track the current page number
  const [currentPage, setCurrentPage] = useState(1);

  /* -------------------------------------------------------------------------
     REFS FOR ANALYTICS & PAGE TRACKING
  ------------------------------------------------------------------------- */
  const timeSpentRef = useRef({});
  const pageTimerRef = useRef(null);
  const visitedPagesRef = useRef(new Set());
  const milestoneVisitedPagesRef = useRef(0);

  /* -------------------------------------------------------------------------
     ANALYTICS STATES
  ------------------------------------------------------------------------- */
  const [totalClicks, setTotalClicks] = useState(0);
  const [selectedTexts, setSelectedTexts] = useState([]);
  const [linkClicks, setLinkClicks] = useState([]);
  const [pageVisitCount, setPageVisitCount] = useState({});

  // The file URL for the PDF viewer
  const fileUrl = url;

  // Initialize analytics data; this object collects contextual info and events.
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
    selectedTexts: [],
    totalClicks: 0,
    inTime: new Date().toISOString(),
    outTime: null,
    mostVisitedPage: null,
    linkClicks: [],
    totalPages: 0,
  });

  // Ref to always have the latest analyticsData (for use in timer callbacks)
  const analyticsDataRef = useRef(analyticsData);
  useEffect(() => {
    analyticsDataRef.current = analyticsData;
  }, [analyticsData, selectedTexts, totalClicks, linkClicks]);

  /* -------------------------------------------------------------------------
     IDENTITY API CALL MANAGEMENT
  ------------------------------------------------------------------------- */
  const identityCalledRef = useRef(false);
  const debouncedSendIdentityRequest = useCallback(
    debounce(async () => {
      if (!userId || !window.location.pathname || identityCalledRef.current) return;
      identityCalledRef.current = true;

      const documentId = window.location.pathname.split("/").pop();
      const requestData = { userId, documentId, mimeType: "pdf" };

      try {
        const response = await fetch("https://user-view-backend.vercel.app/api/user/identify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestData),
        });
        if (!response.ok) {
          throw new Error("Failed to identify user");
        }
        const result = await response.json();
        console.log("User identification successful:", result);
      } catch (error) {
        console.error("Error sending identification request:", error);
      }
    }, 3000),
    [userId, mimeType]
  );

  useEffect(() => {
    if (userId && userId.length > 15 && !identityCalledRef.current) {
      debouncedSendIdentityRequest();
    }
  }, [userId, debouncedSendIdentityRequest]);

  /* -------------------------------------------------------------------------
     UPDATE ANALYTICS CONTEXT VALUES WHEN CONTEXT CHANGES
  ------------------------------------------------------------------------- */
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

  /* -------------------------------------------------------------------------
     LOAD PDF.JS MODULE & WORKER DYNAMICALLY
  ------------------------------------------------------------------------- */
  useEffect(() => {
    const loadPdfjs = async () => {
      try {
        const pdfjsModule = await import("pdfjs-dist/build/pdf");
        const pdfjsWorkerModule = await import("pdfjs-dist/build/pdf.worker.entry");
        pdfjsModule.GlobalWorkerOptions.workerSrc = pdfjsWorkerModule;
        setPdfjs(pdfjsModule);
        setPdfjsWorker(pdfjsWorkerModule);
      } catch (error) {
        console.error("Error loading pdfjs modules:", error);
      }
    };
    loadPdfjs();
  }, []);

  /* -------------------------------------------------------------------------
     HANDLE PAGE CHANGE EVENT
  ------------------------------------------------------------------------- */
  const handlePageChange = useCallback(
    (e) => {
      const newPage = e.currentPage + 1;
      clearInterval(pageTimerRef.current);

      if (!timeSpentRef.current[newPage]) {
        timeSpentRef.current[newPage] = 0;
      }

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

      setPageVisitCount((prevCount) => {
        const newCount = { ...prevCount, [newPage]: (prevCount[newPage] || 0) + 1 };
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
          mostVisitedPage: mostVisitedPage,
        }));
        return newCount;
      });

      setCurrentPage(newPage);
    },
    [setAnalyticsData]
  );

  /* -------------------------------------------------------------------------
     HANDLE TEXT SELECTION
  ------------------------------------------------------------------------- */
  const handleTextSelection = useCallback(() => {
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
      const truncatedText = selectedText.length > 300 ? selectedText.slice(0, 300) : selectedText;
      console.log(`Selected Text on page ${currentPage}: "${truncatedText}"`);

      setSelectedTexts((prevTexts) => {
        const existingText = prevTexts.find(
          (item) => item.selectedText === truncatedText && item.page === currentPage
        );
        if (existingText) {
          return prevTexts.map((item) =>
            item.selectedText === truncatedText && item.page === currentPage
              ? { ...item, count: item.count + 1 }
              : item
          );
        } else {
          return [...prevTexts, { selectedText: truncatedText, count: 1, page: currentPage }];
        }
      });
    }
  }, [currentPage]);

  /* -------------------------------------------------------------------------
     HANDLE LINK CLICKS
  ------------------------------------------------------------------------- */
  const handleLinkClick = useCallback(
    (e) => {
      const linkElement = e.target.closest("a");
      if (linkElement) {
        e.preventDefault();
        const linkUrl = linkElement.href;
        console.log(`Link clicked on page ${currentPage}: ${linkUrl}`);
        window.open(linkUrl, "_blank");
        setLinkClicks((prevLinks) => [
          ...prevLinks,
          { page: currentPage, clickedLink: linkUrl }
        ]);
      }
    },
    [currentPage]
  );

  /* -------------------------------------------------------------------------
     GENERAL CLICK HANDLER
  ------------------------------------------------------------------------- */
  const handleClick = useCallback(() => {
    setTotalClicks((prev) => prev + 1);
  }, []);

  /* -------------------------------------------------------------------------
     PERIODIC ANALYTICS API CALL (Every 15 seconds)
  ------------------------------------------------------------------------- */
  useEffect(() => {
    const interval = setInterval(() => {
      const finalData = {
        ...analyticsDataRef.current,
        outTime: new Date().toISOString(),
        userId: userId,
        selectedTexts: selectedTexts,
        totalClicks: totalClicks,
        linkClicks: linkClicks,
      };

      const sendAnalyticsData = async () => {
        try {
          const response = await fetch("https://user-view-backend.vercel.app/api/PdfInfo/pdfpageinfo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(finalData),
          });
          if (!response.ok) throw new Error("Network response was not ok");
          const result = await response.json();
          console.log("Periodic analytics data sent successfully:", result);
        } catch (error) {
          console.error("Error sending periodic analytics data:", error);
        }
      };

      sendAnalyticsData();
    }, 15000);

    return () => clearInterval(interval);
  }, [userId, selectedTexts, totalClicks, linkClicks]);

  /* -------------------------------------------------------------------------
     SET UP EVENT LISTENERS: Separate for Mobile and Desktop
  ------------------------------------------------------------------------- */
  useEffect(() => {
    const mobileTextSelection = throttle(handleTextSelection, 500);
    const mobileClickHandler = throttle(handleClick, 500);
    const mobileLinkClick = throttle(handleLinkClick, 500);

    const desktopTextSelection = handleTextSelection;
    const desktopClickHandler = handleClick;
    const desktopLinkClick = handleLinkClick;

    if (isMobile) {
      document.addEventListener("touchend", mobileTextSelection, { passive: true });
      document.addEventListener("touchend", mobileClickHandler, { passive: true });
      document.addEventListener("touchend", mobileLinkClick, { passive: true });

      return () => {
        document.removeEventListener("touchend", mobileTextSelection);
        document.removeEventListener("touchend", mobileClickHandler);
        document.removeEventListener("touchend", mobileLinkClick);
      };
    } else {
      document.addEventListener("mouseup", desktopTextSelection);
      document.addEventListener("click", desktopClickHandler);
      document.addEventListener("click", desktopLinkClick);

      return () => {
        document.removeEventListener("mouseup", desktopTextSelection);
        document.removeEventListener("click", desktopClickHandler);
        document.removeEventListener("click", desktopLinkClick);
      };
    }
  }, [handleTextSelection, handleClick, handleLinkClick, isMobile]);

  /* -------------------------------------------------------------------------
     RENDER THE PDF VIEWER COMPONENT
  ------------------------------------------------------------------------- */
  if (!pdfjs || !pdfjsWorker) {
    return <div>Loading...</div>;
  }

  // Conditional styling for mobile vs. desktop
  const containerStyle = isMobile
    ? {
        height: "100vh",
        position: "relative",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
      }
    : { height: "100vh", position: "relative" };

  // Wrapper style to control the viewer width and scrolling
  const viewerWrapperStyle = isMobile
    ? { width: "100%", height: "100%", overflow: "auto" }
    : { width: "80%", height: "100%", margin: "0 auto", overflow: "auto" };

  return (
    <div style={containerStyle}>
      <h1 style={{ textAlign: "center", padding: "20px", position: "absolute", top: 0, width: "100%" }}>
        PDF Viewer
      </h1>
      <Worker workerUrl={pdfjsWorker}>
        <div style={viewerWrapperStyle}>
          <Viewer
            fileUrl={fileUrl}
            // Use "page-fit" for mobile devices so the PDF adjusts to the screen width
            defaultScale={isMobile ? "page-fit" : 1.5}
            renderMode="canvas"
            onPageChange={handlePageChange}
            plugins={[]}
          />
        </div>
      </Worker>
    </div>
  );
};

export default MyPdfViewer;
