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
=============================================================================*/

/**
 * Throttle helper to limit the execution frequency of a function.
 * Useful for mobile events to avoid overwhelming rapid-fire events.
 */
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

/**
 * Debounce helper to execute a function after a delay only if no new call occurs.
 * This is useful to ensure that certain actions (e.g., API calls or heavy computations)
 * only occur after a user has paused their activity.
 */
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

/**
 * Check for mobile devices using user agent string or touch support.
 * Returns true if the device is likely a mobile device.
 */
const checkIsMobile = () => {
    return /Mobi|Android/i.test(navigator.userAgent) || ("ontouchstart" in window);
};

/**
 * Check if the current text selection is entirely within the provided container.
 * This is important to ensure we capture selections only from within our PDF viewer.
 */
const isSelectionWithinContainer = (container) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    return container.contains(range.startContainer) && container.contains(range.endContainer);
};

/**
 * Helper to extract text from a selection range with some extra sanity checks.
 * Here we use the range's toString() method. Additional processing could be added if needed.
 */
const extractSelectedText = () => {
    const selection = window.getSelection();
    if (!selection) return "";
    const selectedText = selection.toString().trim();
    return selectedText;
};

/* =============================================================================
   MAIN COMPONENT: MyPdfViewer
=============================================================================*/
const MyPdfViewer = ({ url, mimeType }) => {
    // ============================================================================
    // USER CONTEXT VALUES
    // ============================================================================
    const { ip, location, userId, region, os, device, browser } = useUser();

    // ============================================================================
    // DEVICE TYPE STATE
    // ============================================================================
    const [isMobile, setIsMobile] = useState(false);
    useEffect(() => {
        setIsMobile(checkIsMobile());
    }, []);

    // ============================================================================
    // REFS AND STATES FOR THE PDF VIEWER AND ANALYTICS
    // ============================================================================
    // Reference to the PDF viewer container. This is where we attach event listeners.
    const viewerContainerRef = useRef(null);

    // State for pdfjs and its worker (dynamically loaded).
    const [pdfjs, setPdfjs] = useState(null);
    const [pdfjsWorker, setPdfjsWorker] = useState(null);

    // Track the current page number (1-indexed).
    const [currentPage, setCurrentPage] = useState(1);

    // ============================================================================
    // ANALYTICS AND PAGE TRACKING REFS
    // ============================================================================
    // Object to track time spent on each page.
    const timeSpentRef = useRef({});
    // Timer for counting time on the current page.
    const pageTimerRef = useRef(null);
    // Set to track visited pages (using a Set to avoid duplicates).
    const visitedPagesRef = useRef(new Set());
    // Milestone counter for pages visited (every 10 pages).
    const milestoneVisitedPagesRef = useRef(0);

    // ============================================================================
    // ANALYTICS STATE VARIABLES
    // ============================================================================
    const [totalClicks, setTotalClicks] = useState(0);
    const [selectedTexts, setSelectedTexts] = useState([]);
    const [linkClicks, setLinkClicks] = useState([]);
    const [pageVisitCount, setPageVisitCount] = useState({});

    // The file URL for the PDF viewer.
    const fileUrl = url;

    // Analytics data object containing various contextual and interaction data.
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
        inTime: new Date().toISOString(), // Set on initial load.
        outTime: null,
        mostVisitedPage: null,
        linkClicks: [],
        totalPages: 0,
    });

    // Reference to keep the latest analytics data for use in timer callbacks.
    const analyticsDataRef = useRef(analyticsData);
    useEffect(() => {
        analyticsDataRef.current = analyticsData;
    }, [analyticsData, selectedTexts, totalClicks, linkClicks]);

    // ============================================================================
    // IDENTITY API CALL MANAGEMENT
    // ============================================================================
    // Ref to ensure the identity API is only called once.
    const identityCalledRef = useRef(false);

    // Debounced function to send identity API call after a 3-second delay.
    const debouncedSendIdentityRequest = useCallback(
        debounce(async () => {
            // Guard against missing data or repeated calls.
            if (!userId || !window.location.pathname || identityCalledRef.current) return;
            identityCalledRef.current = true; // Mark as called.

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

    // Trigger the identity API call once the userId becomes stable.
    useEffect(() => {
        if (userId && userId.length > 15 && !identityCalledRef.current) {
            debouncedSendIdentityRequest();
        }
    }, [userId, debouncedSendIdentityRequest]);

    // ============================================================================
    // UPDATE ANALYTICS CONTEXT WHEN CONTEXT VALUES CHANGE
    // ============================================================================
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

    // ============================================================================
    // DYNAMICLY LOAD PDF.JS MODULE AND WORKER
    // ============================================================================
    useEffect(() => {
        const loadPdfjs = async () => {
            try {
                // Dynamically import pdfjs modules.
                const pdfjsModule = await import("pdfjs-dist/build/pdf");
                const pdfjsWorkerModule = await import("pdfjs-dist/build/pdf.worker.entry");
                // Set the worker source for pdfjs.
                pdfjsModule.GlobalWorkerOptions.workerSrc = pdfjsWorkerModule;
                setPdfjs(pdfjsModule);
                setPdfjsWorker(pdfjsWorkerModule);
            } catch (error) {
                console.error("Error loading pdfjs modules:", error);
            }
        };
        loadPdfjs();
    }, []);

    // ============================================================================
    // HANDLE PAGE CHANGE EVENT
    // ============================================================================
    // When the page changes, update time spent and page visit tracking.
    const handlePageChange = useCallback(
        (e) => {
            // Pages are 0-indexed; adjust to 1-indexed.
            const newPage = e.currentPage + 1;
            // Clear any existing timer for the previous page.
            clearInterval(pageTimerRef.current);

            // Ensure a timer exists for the new page.
            if (!timeSpentRef.current[newPage]) {
                timeSpentRef.current[newPage] = 0;
            }

            // Start a timer for the new page to count time in seconds.
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

            // Update the visited pages set.
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

            // Update page visit counts and compute the most visited page.
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

    // ============================================================================
    // HANDLE TEXT SELECTION
    // ============================================================================
    // This function captures text selection from within the PDF viewer.
    // It now waits for a brief delay (via the selectionchange listener)
    // to ensure that the full selection is captured.
    const handleTextSelection = useCallback(() => {
        // Reference to the container for the PDF viewer.
        const container = viewerContainerRef.current;
        if (!container) return;
        // Check if the selection is within the viewer container.
        if (!isSelectionWithinContainer(container)) return;

        // Extract the selected text.
        const selectedText = extractSelectedText();
        if (selectedText) {
            // Limit the selected text to 300 characters.
            const truncatedText = selectedText.length > 300 ? selectedText.slice(0, 300) : selectedText;
            console.log(`Selected Text on page ${currentPage}: "${truncatedText}"`);

            // Update the selectedTexts state.
            setSelectedTexts((prevTexts) => {
                // Check if this selection (and page) already exists.
                const existingText = prevTexts.find(
                    (item) => item.selectedText === truncatedText && item.page === currentPage
                );
                if (existingText) {
                    // If it exists, increment the count.
                    return prevTexts.map((item) =>
                        item.selectedText === truncatedText && item.page === currentPage
                            ? { ...item, count: item.count + 1 }
                            : item
                    );
                } else {
                    // Otherwise, add it to the array.
                    return [...prevTexts, { selectedText: truncatedText, count: 1, page: currentPage }];
                }
            });
        }
    }, [currentPage]);

    // ============================================================================
    // HANDLE LINK CLICKS
    // ============================================================================
    // Intercepts clicks on links inside the PDF and logs the event.
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

    // ============================================================================
    // GENERAL CLICK HANDLER
    // ============================================================================
    // Increments the total click count.
    const handleClick = useCallback(() => {
        setTotalClicks((prev) => prev + 1);
    }, []);

    // ============================================================================
    // PERIODIC ANALYTICS API CALL (Every 15 seconds)
    // ============================================================================
    // This effect sends a consolidated payload of analytics data periodically.
    useEffect(() => {
        const interval = setInterval(() => {
            // Construct the final analytics data payload.
            const finalData = {
                ...analyticsDataRef.current,
                outTime: new Date().toISOString(),
                userId: userId,
                selectedTexts: selectedTexts,
                totalClicks: totalClicks,
                linkClicks: linkClicks,
            };

            // Async function to send analytics data to the API.
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

    // ============================================================================
    // SET UP EVENT LISTENERS FOR TEXT SELECTION AND CLICK EVENTS
    // ============================================================================
    // This useEffect adds event listeners to handle text selection and clicks.
    // We now add a global document listener for the "selectionchange" event,
    // which is debounced to avoid capturing incomplete selections.
    useEffect(() => {
        // Create a debounced version of the text selection handler.
        const debouncedSelectionHandler = debounce(() => {
            handleTextSelection();
        }, 300);

        // Add global listener for selection changes.
        document.addEventListener("selectionchange", debouncedSelectionHandler);

        // Setup separate event listeners for mobile and desktop clicks.
        const container = viewerContainerRef.current;
        if (!container) return;

        if (isMobile) {
            // Throttled callbacks for mobile devices.
            const mobileClickHandler = throttle(handleClick, 500);
            const mobileLinkClick = throttle(handleLinkClick, 500);

            container.addEventListener("touchend", mobileClickHandler, { passive: true });
            container.addEventListener("touchend", mobileLinkClick, { passive: true });

            // Cleanup on unmount.
            return () => {
                document.removeEventListener("selectionchange", debouncedSelectionHandler);
                container.removeEventListener("touchend", mobileClickHandler);
                container.removeEventListener("touchend", mobileLinkClick);
            };
        } else {
            // For desktops, add mouseup and click events.
            container.addEventListener("mouseup", handleTextSelection);
            container.addEventListener("click", handleClick);
            container.addEventListener("click", handleLinkClick);

            // Cleanup on unmount.
            return () => {
                document.removeEventListener("selectionchange", debouncedSelectionHandler);
                container.removeEventListener("mouseup", handleTextSelection);
                container.removeEventListener("click", handleClick);
                container.removeEventListener("click", handleLinkClick);
            };
        }
    }, [handleTextSelection, handleClick, handleLinkClick, isMobile]);

    // ============================================================================
    // ADDITIONAL EVENT LISTENERS AND DEBUGGING (EXTRA LINES FOR CLARITY)
    // ============================================================================
    // The following block includes extra logging and debugging information.
    // This is to help track user interactions in greater detail and to ensure
    // that the analytics events are firing as expected.
    useEffect(() => {
        const logDebugInfo = () => {
            console.log("=== Debug Info ===");
            console.log("Current Page:", currentPage);
            console.log("Total Clicks:", totalClicks);
            console.log("Selected Texts:", selectedTexts);
            console.log("Link Clicks:", linkClicks);
            console.log("Page Visit Count:", pageVisitCount);
            console.log("Time Spent Per Page:", timeSpentRef.current);
            console.log("==================");
        };

        // Log debug info every 30 seconds.
        const debugInterval = setInterval(() => {
            logDebugInfo();
        }, 30000);

        return () => clearInterval(debugInterval);
    }, [currentPage, totalClicks, selectedTexts, linkClicks, pageVisitCount]);

    // ============================================================================
    // CLEANUP ON UNMOUNT: Clear any remaining timers
    // ============================================================================
    useEffect(() => {
        return () => {
            clearInterval(pageTimerRef.current);
        };
    }, []);

    // ============================================================================
    // RENDER THE PDF VIEWER COMPONENT
    // ============================================================================
    // Show a loading state until pdfjs and its worker are loaded.
    if (!pdfjs || !pdfjsWorker) {
        return (
            <div style={{ textAlign: "center", paddingTop: "50px", fontSize: "18px" }}>
                Loading PDF Viewer...
            </div>
        );
    }

    // ============================================================================
    // RENDER THE FINAL COMPONENT
    // ============================================================================
    return (
        <div
            ref={viewerContainerRef}
            style={{
                height: "100vh",
                position: "relative",
                backgroundColor: "#f7f7f7",
                padding: "10px",
                overflow: "auto",
            }}
        >
            <h1 style={{ textAlign: "center", padding: "20px", color: "#333" }}>PDF Viewer</h1>
            <Worker workerUrl={pdfjsWorker}>
                <Viewer
                    fileUrl={fileUrl}
                    defaultScale={1.5}
                    renderMode="canvas"
                    onPageChange={handlePageChange}
                    plugins={[]}
                />
            </Worker>
            {/* Additional footer for debugging and analytics info */}
            <footer style={{ marginTop: "20px", textAlign: "center", fontSize: "14px", color: "#666" }}>
                <p>PDF Viewer Component powered by @react-pdf-viewer/core</p>
                <p>User Analytics are being recorded for improvements.</p>
            </footer>
        </div>
    );
};

/* =============================================================================
   EXPORT COMPONENT
=============================================================================*/
// Export the component as default.
export default MyPdfViewer;
