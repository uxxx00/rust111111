"use client";
import { useState, useEffect, useRef } from "react";
import { Card, CardHeader, CardBody } from "@heroui/card";
import { Checkbox } from "@heroui/checkbox";
import { Input } from "@heroui/input";
import { ButtonGroup, Button } from "@heroui/button";
import { Slider } from "@heroui/slider";
import { Tooltip } from "@heroui/tooltip";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { StatCard } from "../components/StatCard";
import { useGetProfile, logout, useGetSubscription } from "./functions/UserAPI";
import { useViewerCount } from "../hooks/useViewerCount";
import { ViewerStatCard } from "../components/ViewerStatCard";
import { useWebSocketBot } from "@/hooks/useWebSocketBot";
import { WebSocketStatus } from "@/components/WebSocketStatus";
import { SystemMetrics } from "../components/SystemMetrics";
import { StatusBanner } from "../components/StatusBanner";
import { animate, stagger } from "animejs";
import { MotionCard } from "../components/MotionCard";
import { PatreonLinkButton } from "@/components/PatreonLinkButton";

interface MetricData {
  label: string;
  value: number;
  color: string;
  unit: string;
  history: number[];
  maxValue: number;
}

const ALLOWED_STABILITY_SUBSCRIPTIONS = new Set([
  "active",
  "premium",
  "lifetime",
]);

export default function ViewerBotInterface() {
  const { data: profile } = useGetProfile();
  const { data: subscription, isLoading: isSubscriptionLoading } =
    useGetSubscription();

  // Hook WebSocket
  const {
    isConnected: wsConnected,
    status: wsStatus,
    error: wsError,
    currentUrl: wsUrl,
    stats: wsStats,
    isRunning: wsBotRunning,
    startBot: wsStartBot,
    stopBot: wsStopBot,
    reconnect: wsReconnect,
    logs: wsLogs,
  } = useWebSocketBot();

  const [config, setConfig] = useState({
    threads: 0,
    channelName: "",
    authToken: "",
    messagesPerMinute: 1,
    enableChat: false,
    proxyType: "all",
    timeout: 10000,
    stabilityMode: false,
    proxyText: "",
  });

  const [botProfiles, setBotProfiles] = useState<{username: string, profilepic: string}[]>([]);

  // Fetch bot profiles when authToken changes
  useEffect(() => {
    const fetchProfiles = async () => {
      if (!config.authToken) {
        setBotProfiles([]);
        return;
      }
      
      const tokens = config.authToken.split('\n').filter(t => t.trim().length > 0);
      if (tokens.length === 0) return;
      
      try {
        const response = await fetch('http://localhost:8765/verify_tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tokens })
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.profiles) {
            setBotProfiles(data.profiles);
          }
        }
      } catch (err) {
        console.error("Failed to verify tokens", err);
      }
    };
    
    // Debounce to avoid spamming the API
    const timeoutId = setTimeout(fetchProfiles, 1000);
    return () => clearTimeout(timeoutId);
  }, [config.authToken]);

  // Load config from localStorage on mount
  useEffect(() => {
    const savedConfig = localStorage.getItem("kickBotConfig");
    if (savedConfig) {
      try {
        setConfig(JSON.parse(savedConfig));
      } catch (e) {
        console.error("Failed to parse config");
      }
    }
  }, []);

  // Save config to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("kickBotConfig", JSON.stringify(config));
  }, [config]);
  const { viewerCount: currentViewers } = useViewerCount(
    config?.channelName || profile?.user?.TwitchUsername
  );

  const backendSubscriptionStatus =
    typeof wsStats?.config?.subscription_status === "string"
      ? wsStats.config.subscription_status.toLowerCase()
      : null;

  const profileSubscriptionStatus =
    typeof profile?.user?.subscription === "string"
      ? profile.user.subscription.toLowerCase()
      : null;

  const subscriptionPlan =
    typeof subscription?.plan === "string"
      ? subscription.plan.toLowerCase()
      : null;

  const isDevMode = process.env.NODE_ENV === "development";

  const hasActiveSubscription =
    isDevMode ||
    (backendSubscriptionStatus &&
      ALLOWED_STABILITY_SUBSCRIPTIONS.has(backendSubscriptionStatus)) ||
    (profileSubscriptionStatus &&
      ALLOWED_STABILITY_SUBSCRIPTIONS.has(profileSubscriptionStatus)) ||
    (subscriptionPlan &&
      ALLOWED_STABILITY_SUBSCRIPTIONS.has(subscriptionPlan)) ||
    Boolean(subscription?.isSubscribed);

  const normalizedSubscriptionStatus = hasActiveSubscription
    ? backendSubscriptionStatus &&
      ALLOWED_STABILITY_SUBSCRIPTIONS.has(backendSubscriptionStatus)
      ? backendSubscriptionStatus
      : profileSubscriptionStatus &&
        ALLOWED_STABILITY_SUBSCRIPTIONS.has(profileSubscriptionStatus)
        ? profileSubscriptionStatus
        : subscriptionPlan &&
          ALLOWED_STABILITY_SUBSCRIPTIONS.has(subscriptionPlan)
          ? subscriptionPlan
          : "active"
    : "none";

  const isStabilityLocked = false; // Unlocked for free usage

  // DEBUG: Removed test animation that was causing the red square

  const [isLoading, setIsLoading] = useState(false);
  const [proxyFile, setProxyFile] = useState<File | null>(null);
  const [unactivated, setUnactivated] = useState(false);
  const [stats, setStats] = useState({
    totalProxies: 0,
    aliveProxies: 0,
    activeThreads: 0,
    request_count: 0,
    viewers: currentViewers, // Utilisé maintenant la valeur en direct
    targetViewers: 0,
  });

  const [channelNameModified, setChannelNameModified] = useState(false);

  // Add new state for bot status
  const [botStatus, setBotStatus] = useState({
    state: "initialized",
    message: "",
    proxy_count: 0,
    proxy_loading_progress: 0,
    startup_progress: 0,
  });

  const animatedContainerRef = useRef<HTMLDivElement | null>(null);
  const actionButtonRef = useRef<HTMLButtonElement | null>(null);
  const statsCardsRef = useRef<HTMLDivElement | null>(null);
  const inputsRef = useRef<HTMLDivElement[]>([]);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  // Mark component as mounted (client-side only)
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Animate individual stat cards inside the monitoring section
  useEffect(() => {
    if (!isMounted || !statsCardsRef.current) return;

    // Add delay to ensure cards are fully rendered after MotionCard
    const timer = setTimeout(() => {
      if (!statsCardsRef.current) return;

      const statCards =
        statsCardsRef.current.querySelectorAll(".stat-card-item");
      if (statCards.length === 0) {
        console.warn("No stat cards found for animation");
        return;
      }

      try {
        // Animate with stagger
        animate(statCards, {
          translateY: [40, 0],
          opacity: [0, 1],
          scale: [0.9, 1],
          duration: 600,
          delay: stagger(100, { start: 400 }), // Start after MotionCard animation
          ease: "outQuad",
        });
      } catch (e) {
        console.warn("Stat cards animation failed:", e);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [isMounted]); // Only animate on mount

  // Animate configuration inputs with creative slide and fade
  useEffect(() => {
    if (!isMounted || !animatedContainerRef.current) return;

    // Wait a bit for DOM to be fully ready
    const timer = setTimeout(() => {
      if (!animatedContainerRef.current) return;

      const configInputs =
        animatedContainerRef.current.querySelectorAll(".config-input");

      if (configInputs.length === 0) {
        console.warn("No config inputs found");
        return;
      }

      try {
        // Set initial state with alternating directions
        configInputs.forEach((input, index) => {
          (input as HTMLElement).style.opacity = "0";
          const direction = index % 2 === 0 ? -40 : 40;
          (input as HTMLElement).style.transform =
            `translateX(${direction}px) scale(0.9)`;
        });

        // Animate with alternating directions
        setTimeout(() => {
          animate(configInputs, {
            opacity: [0, 1],
            translateX: [(_: any, i: number) => (i % 2 === 0 ? -40 : 40), 0],
            scale: [0.9, 1],
            duration: 700,
            delay: (_: any, i: number) => {
              const delayAttr = (configInputs[i] as HTMLElement).getAttribute(
                "data-delay"
              );
              return delayAttr ? parseInt(delayAttr) : i * 60;
            },
            ease: "outBack(1.7)",
          });
        }, 100);
      } catch (e) {
        console.warn("Config inputs animation failed:", e);
        // Fallback
        configInputs.forEach((input) => {
          (input as HTMLElement).style.opacity = "1";
          (input as HTMLElement).style.transform = "translateX(0) scale(1)";
        });
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [isMounted]);

  // Creative entrance animations for main sections
  useEffect(() => {
    if (!isMounted || !animatedContainerRef.current) return;
    const cards =
      animatedContainerRef.current.querySelectorAll(".anim-section");
    if (cards.length === 0) return;

    try {
      // Set initial state with perspective
      cards.forEach((card, index) => {
        (card as HTMLElement).style.opacity = "0";
        (card as HTMLElement).style.transformOrigin = "center bottom";
        (card as HTMLElement).style.transform = `perspective(1000px) rotateY(${index % 2 === 0 ? -15 : 15
          }deg) translateY(50px)`;
      });

      // Animate with 3D rotation
      setTimeout(() => {
        animate(cards, {
          opacity: [0, 1],
          translateY: [50, 0],
          rotateY: [(_: any, i: number) => (i % 2 === 0 ? -15 : 15), 0],
          duration: 900,
          delay: stagger(120, { start: 300 }),
          ease: "outExpo",
        });
      }, 50);
    } catch (e) {
      console.warn("Animation initialization failed:", e);
      // Fallback
      cards.forEach((card) => {
        (card as HTMLElement).style.opacity = "1";
        (card as HTMLElement).style.transform = "translateY(0) rotateY(0)";
      });
    }
  }, [isMounted]);

  // Button animations removed for cleaner UX

  useEffect(() => {
    if (botStatus.state.toLowerCase() === "stopping") {
      setUnactivated(true);
    } else {
      setUnactivated(false);
    }
  }, [botStatus]);

  const [systemMetrics, setSystemMetrics] = useState<{
    cpu: MetricData;
    memory: MetricData;
    network_up: MetricData;
    network_down: MetricData;
  }>({
    cpu: {
      label: "CPU Usage",
      value: 0,
      color: "#3b82f6",
      unit: "%",
      history: [],
      maxValue: 100,
    },
    memory: {
      label: "Memory Usage",
      value: 0,
      color: "#10b981",
      unit: "%",
      history: [],
      maxValue: 100,
    },
    network_up: {
      label: "Upload",
      value: 0,
      color: "#8b5cf6",
      unit: "MB/s",
      history: [],
      maxValue: 10, // Ajustez selon vos besoins
    },
    network_down: {
      label: "Download",
      value: 0,
      color: "#ef4444",
      unit: "MB/s",
      history: [],
      maxValue: 10, // Ajustez selon vos besoins
    },
  });

  // Sync WebSocket stats avec les stats locales
  useEffect(() => {
    if (!wsStats) return;

    const system_metrics = wsStats.system_metrics || {
      cpu: 0,
      memory: 0,
      network_up: 0,
      network_down: 0,
    };

    // Update system metrics
    setSystemMetrics((prevMetrics) => {
      const updateMetric = (
        metric: MetricData,
        newValue: number | undefined
      ): MetricData => ({
        ...metric,
        value: typeof newValue === "number" ? newValue : 0,
        history: [
          ...metric.history.slice(-29),
          typeof newValue === "number" ? newValue : 0,
        ],
      });
      return {
        cpu: updateMetric(prevMetrics.cpu, system_metrics.cpu),
        memory: updateMetric(prevMetrics.memory, system_metrics.memory),
        network_up: updateMetric(
          prevMetrics.network_up,
          Number(Number(system_metrics.network_up).toFixed(2))
        ),
        network_down: updateMetric(
          prevMetrics.network_down,
          Number(Number(system_metrics.network_down).toFixed(2))
        ),
      };
    });

    // Update bot stats
    setStats((prevStats) => ({
      ...prevStats,
      activeThreads: wsStats.active_threads || 0,
      totalProxies: wsStats.total_proxies || 0,
      aliveProxies: wsStats.alive_proxies || 0,
      request_count: wsStats.request_count || 0,
    }));

    // Update bot status
    if (wsStats.status) {
      setBotStatus(wsStats.status);
    }

    // Update isLoading based on bot state
    setIsLoading(wsStats.is_running || false);
  }, [wsStats]);

  useEffect(() => {
    // If profile loads and channel name is empty, set it ONLY ONCE
    if (
      profile?.user?.TwitchUsername &&
      !config.channelName &&
      !channelNameModified
    ) {
      setConfig((prev) => ({
        ...prev,
        channelName: profile.user.TwitchUsername as string,
      }));
    }
  }, [profile, channelNameModified, config.channelName]);

  // Sync config from WebSocket stats ONLY on first load
  useEffect(() => {
    if (wsStats && wsStats.config && wsStats.is_running) {
      const { threads, timeout, proxy_type, stability_mode } = wsStats.config;
      const parsedTimeout = Number.parseInt(`${timeout}`, 10);
      setConfig((prevConfig) => ({
        ...prevConfig,
        threads: threads ?? prevConfig.threads,
        timeout: Number.isNaN(parsedTimeout) ? 10000 : parsedTimeout,
        proxyType: proxy_type ?? prevConfig.proxyType,
        channelName: wsStats.channel_name || prevConfig.channelName,
        stabilityMode:
          typeof stability_mode === "boolean"
            ? stability_mode
            : prevConfig.stabilityMode,
      }));
    }
  }, [wsStats?.is_running]); // Ne sync que quand le bot change d'état

  useEffect(() => {
    if (isStabilityLocked && config.stabilityMode) {
      setConfig((prevConfig) => ({
        ...prevConfig,
        stabilityMode: false,
      }));
    }
  }, [isStabilityLocked, config.stabilityMode]);

  const handleStart = async () => {
    // Check WebSocket connection
    if (!wsConnected) {
      toast.error(
        "Local service not connected. Please launch the helper or download it."
      );
      return;
    }

    // Prevent starting during transitional states
    if (
      botStatus.state.toLowerCase() === "stopping" ||
      botStatus.state.toLowerCase() === "starting"
    ) {
      return;
    }
    if (!config.channelName) {
      toast.error("Channel name or url is required");
      return;
    } else if (config.threads === 0) {
      toast.error("Threads count must be greater than 0");
      return;
    }
    // Stability mode check removed so user can use it freely
    try {
      setIsLoading(true);
      await wsStartBot({
        channelName: config.channelName,
        threads: config.threads,
        proxyFile: proxyFile || (config.proxyText ? new File([config.proxyText], "proxies.txt", { type: "text/plain" }) : undefined),
        timeout: config.timeout,
        proxyType: config.proxyType,
        stabilityMode: config.stabilityMode,
        subscriptionStatus: normalizedSubscriptionStatus,
        authToken: config.authToken,
        enableChat: config.enableChat,
        messagesPerMinute: config.messagesPerMinute,
      });
      toast.success(
        "Bot started successfully!🚀 It may take a while before the viewers appear on the stream."
      );
    } catch (err) {
      toast.error(
        `Failed to start bot: ${err instanceof Error ? err.message : "Unknown error"
        }`
      );
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    if (!wsConnected) {
      toast.error("Local service not connected.");
      return;
    }

    if (
      botStatus.state.toLowerCase() === "stopping" ||
      botStatus.state.toLowerCase() === "starting"
    ) {
      return;
    }
    try {
      wsStopBot();
      toast.success("Bot stopped successfully!");
      setIsLoading(false);
      setStats((prevStats) => ({
        ...prevStats,
        activeThreads: 0,
        request_count: 0,
      }));
    } catch (err) {
      toast.error("Failed to stop bot");
      console.error("Failed to stop bot:", err);
    }
  };

  const handleLogout = async () => {
    try {
      if (isLoading && wsConnected) {
        wsStopBot();
        setIsLoading(false);
      }
      await logout();
      toast.success("Logged out successfully!");
      window.location.href = "/login";
    } catch (error) {
      toast.error("Failed to logout");
      console.error("Logout error:", error);
    }
  };

  const handleChannelNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setChannelNameModified(true);
    setConfig((prev) => ({
      ...prev,
      channelName: e.target.value,
    }));
  };

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8" ref={animatedContainerRef}>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Section */}
        <MotionCard
          index={0}
          className="relative text-center p-8 bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden"
        >
          <div className="absolute left-4 top-4">
            <PatreonLinkButton />
          </div>
          {profile && (
            <Button
              variant="bordered"
              onPress={handleLogout}
              className="absolute right-4 top-4 hover:scale-105 transition-transform border-white/10 hover:bg-red-500/10 hover:text-red-500 text-zinc-400"
              color="danger"
              size="sm"
            >
              Logout
            </Button>
          )}
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black mb-3 text-white tracking-tighter">
            KICK<span className="text-green-500">VIEWER</span>BOT
          </h1>
          <p className="text-base sm:text-lg md:text-xl font-medium text-zinc-400 tracking-wide">
            {profile
              ? `Welcome back, ${profile.user.username}`
              : "Monitor and control your viewer bot"}
          </p>
          <div className="mt-6 flex justify-center">
            <WebSocketStatus
              status={wsStatus}
              currentUrl={wsUrl}
              onRetry={wsReconnect}
            />
          </div>
        </MotionCard>

        {/* Monitoring Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <MotionCard
            index={1}
            className="h-full bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden"
          >
            <CardHeader className="pb-2 px-6 pt-6">
              <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
                <span className="w-2 h-8 bg-green-500 rounded-full"></span>
                Live Monitoring
              </h2>
            </CardHeader>
            <CardBody className="px-6 pb-6 pt-2">
              <div
                ref={statsCardsRef}
                className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full"
              >
                <div className="w-full stat-card-item">
                  <ViewerStatCard value={currentViewers} />
                </div>
                <div className="w-full stat-card-item">
                  <StatCard
                    title="Active Threads"
                    value={stats.activeThreads}
                    total={config.threads}
                  />
                </div>
                <div className="w-full stat-card-item">
                  <StatCard
                    title="Proxies"
                    value={botStatus.proxy_count || stats.totalProxies}
                    total={botStatus.proxy_count || stats.totalProxies}
                  />
                </div>
                <div className="w-full stat-card-item">
                  <StatCard
                    title={
                      wsStats?.config?.stability_mode
                        ? "Active Connections"
                        : "Requests"
                    }
                    value={stats.request_count}
                  />
                </div>
              </div>
            </CardBody>
          </MotionCard>

          <MotionCard index={2} disableHoverTilt={true} className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden">
            <SystemMetrics metrics={systemMetrics} />
          </MotionCard>
        </div>

        {/* Control Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <MotionCard
            index={3}
            className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden"
          >
            <CardHeader className="pb-2 px-6 pt-6">
              <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
                <span className="w-2 h-8 bg-green-500 rounded-full"></span>
                Configuration
              </h2>
            </CardHeader>
            <CardBody className="space-y-6">
              <Input
                label="Channel Name or URL"
                value={config.channelName}
                placeholder={
                  profile?.user?.TwitchUsername || "Enter channel name or URL"
                }
                onChange={handleChannelNameChange}
                className="config-input"
                data-delay="0"
              />
              <div
                className="flex items-center space-x-2 config-input"
                data-delay="100"
              >
                <Input
                  type="number"
                  label="Number of Threads"
                  value={config.threads === 0 ? "" : config.threads.toString()}
                  min={0}
                  max={10000}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      threads:
                        e.target.value === ""
                          ? 0
                          : Math.min(10000, parseInt(e.target.value) || 0),
                    })
                  }
                />
                <Tooltip
                  content={
                    <div className="max-w-xs p-2">
                      <p>
                        Threads determine how many simultaneous connections the
                        bot will make.
                      </p>
                      <p className="mt-1">
                        More threads = more viewers, but requires more resources
                        and stable proxies.
                      </p>
                      <p className="mt-1">
                        Recommended: Start with 100-200 threads.
                      </p>
                    </div>
                  }
                >
                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-default-100 text-default-500 cursor-help">
                    ?
                  </div>
                </Tooltip>
              </div>
              <div className="config-input" data-delay="200">
                <Slider
                  value={[config.timeout]}
                  defaultValue={[10000]}
                  maxValue={20000}
                  onChange={(value) =>
                    setConfig({
                      ...config,
                      timeout: Number(Array.isArray(value) ? value[0] : value),
                    })
                  }
                  getValue={(timeout) => `${timeout}ms`}
                  label="Request Timeout"
                  step={100}
                />
              </div>
              <div className="space-y-2 config-input" data-delay="300">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium block text-zinc-300">
                      Proxy List
                    </label>
                    <Tooltip
                      content={
                        <div className="max-w-xs p-2 text-zinc-300">
                          <p className="font-medium mb-1 text-white">
                            Supported proxy formats:
                          </p>
                          <ul className="list-disc pl-4 space-y-1">
                            <li>IP:PORT</li>
                            <li>http://IP:PORT</li>
                            <li>socks4://IP:PORT</li>
                            <li>socks5://IP:PORT</li>
                            <li>USERNAME:PASSWORD@IP:PORT</li>
                          </ul>
                        </div>
                      }
                    >
                      <div className="flex items-center justify-center w-4 h-4 rounded-full bg-zinc-800 text-zinc-400 cursor-help text-[10px]">
                        ?
                      </div>
                    </Tooltip>
                  </div>
                  <Button
                    as="label"
                    size="sm"
                    className="h-7 px-3 text-xs bg-zinc-800/50 hover:bg-zinc-700 text-zinc-300 border border-zinc-700/50 rounded-md cursor-pointer transition-colors"
                  >
                    <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    {proxyFile ? proxyFile.name : "Upload .txt"}
                    <Input
                      type="file"
                      accept=".txt"
                      onChange={(e) => setProxyFile(e.target.files?.[0] || null)}
                      className="hidden"
                    />
                  </Button>
                </div>
                <div className="relative">
                  <textarea
                    className="w-full bg-zinc-900/80 border border-zinc-800 rounded-lg p-3 text-zinc-300 focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/50 transition-all text-xs font-mono"
                    value={config.proxyText}
                    onChange={(e) => setConfig({ ...config, proxyText: e.target.value })}
                    rows={4}
                    placeholder="Paste your proxies here (one per line)...&#10;192.168.1.1:8080&#10;user:pass@10.0.0.1:3128"
                    disabled={!!proxyFile}
                  />
                </div>
                <p className="text-[11px] text-zinc-500">
                  {proxyFile 
                    ? "File uploaded. Clear file to paste manually." 
                    : "Leave empty to use automatic free proxies from our servers."}
                </p>
              </div>
            </CardBody>
          </MotionCard>

          <MotionCard
            index={4}
            className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden"
          >
            <CardHeader className="pb-2">
              <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
                <span className="w-2 h-8 bg-green-500 rounded-full"></span>
                Advanced Settings
              </h2>
            </CardHeader>
            <CardBody className="space-y-6">
              <div className="relative">
                <p className="text-sm text-gray-400 mb-1">Kick Auth Tokens (Paste 1 per line for multiple bots!)</p>
                <textarea
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-white focus:outline-none focus:border-purple-500 transition-colors"
                  value={config.authToken}
                  onChange={(e) =>
                    setConfig({ ...config, authToken: e.target.value })
                  }
                  rows={4}
                  placeholder="Insert tokens here..."
                />
                
                {/* Display active bot profiles */}
                {botProfiles.length > 0 && (
                  <div className="mt-3 bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                    <p className="text-xs text-gray-400 mb-2">Connected Accounts ({botProfiles.length}):</p>
                    <div className="flex flex-wrap gap-2">
                      {botProfiles.map((profile, i) => (
                        <div key={i} className="flex items-center gap-2 bg-zinc-900 rounded-full pr-3 pl-1 py-1 border border-zinc-800">
                          <img 
                            src={profile.profilepic || "https://ui-avatars.com/api/?name=" + profile.username + "&background=18181b&color=a855f7"} 
                            alt={profile.username}
                            className="w-6 h-6 rounded-full"
                          />
                          <span className="text-xs text-gray-200">{profile.username}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="relative">
                <Slider
                  value={[config.messagesPerMinute]}
                  defaultValue={[1]}
                  maxValue={60}
                  isDisabled={false}
                  onChange={(value) =>
                    setConfig({
                      ...config,
                      messagesPerMinute: Number(Array.isArray(value) ? value[0] : value),
                    })
                  }
                  label="Messages Per Minute"
                  getValue={(value) => `${value} messages`}
                  step={1}
                />
              </div>

              <div className="relative">
                <Checkbox 
                  isSelected={config.enableChat}
                  onValueChange={(isSelected) => setConfig({ ...config, enableChat: isSelected })}
                  isDisabled={false}
                >
                  <span className="text-white">Enable Chat Messages (Unlocked)</span>
                </Checkbox>
              </div>

              <div className="relative">
                <div className="flex items-center gap-2 mb-2">
                  <label className="text-sm font-medium">Stability Mode</label>
                  <Tooltip
                    content={
                      <div className="max-w-xs p-2">
                        <div>
                          <strong>Stability Mode</strong> uses advanced
                          algorithms to keep your viewer count steady,
                          minimizing sudden drops or spikes. <br />
                          <span className="block mt-2"></span>
                          <span className="font-semibold">
                            How it works: If you set <code>100</code> threads,
                            the bot will aim for approximately{" "}
                            <b>140 viewers</b> (about 1.4× your thread count),
                            and will automatically adjust to keep your live
                            viewers within a narrow range (e.g., between 135 and
                            145).
                          </span>
                          <span className="block mt-2 text-xs text-gray-500">
                            This feature is ideal for streamers who want a more
                            natural and reliable viewer presence.{" "}
                            <span className="text-green-500 block mt-1">
                              Unlocked for free!
                            </span>
                          </span>
                        </div>
                      </div>
                    }
                    placement="right"
                  >
                    <div className="flex items-center justify-center w-5 h-5 rounded-full bg-default-100 text-default-500 cursor-help text-xs">
                      ?
                    </div>
                  </Tooltip>
                </div>
                <ButtonGroup
                  radius="md"
                  className="overflow-hidden rounded-lg border border-default-200/40"
                >
                  <Tooltip
                    content="Subscribe to unlock stability mode."
                    placement="top"
                    isDisabled={!isStabilityLocked || config.stabilityMode}
                  >
                    <Button
                      variant={config.stabilityMode ? "solid" : "bordered"}
                      onPress={() =>
                        setConfig((prev) => ({
                          ...prev,
                          stabilityMode: true,
                        }))
                      }
                      isDisabled={unactivated || isStabilityLocked}
                    >
                      On
                    </Button>
                  </Tooltip>
                  <Button
                    variant={!config.stabilityMode ? "solid" : "bordered"}
                    onPress={() =>
                      setConfig((prev) => ({
                        ...prev,
                        stabilityMode: false,
                      }))
                    }
                    isDisabled={unactivated}
                  >
                    Off
                  </Button>
                </ButtonGroup>
                {isStabilityLocked && !isSubscriptionLoading && (
                  <p className="mt-2 text-xs text-yellow-500">
                    An active subscription is required to enable stability mode.
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">
                  Proxy Type
                </label>
                <ButtonGroup
                  radius="md"
                  className="overflow-hidden rounded-lg border border-default-200/40 backdrop-blur-sm"
                >
                  {["http", "socks4", "socks5", "all"].map((type) => (
                    <Button
                      key={type}
                      variant={config.proxyType === type ? "solid" : "bordered"}
                      onPress={() => setConfig({ ...config, proxyType: type })}
                      disabled={unactivated}
                    >
                      {type}
                    </Button>
                  ))}
                </ButtonGroup>
              </div>
            </CardBody>
          </MotionCard>
        </div>

        {/* Status Banner with new styling */}
        <div className="transform hover:scale-[1.02] transition-transform duration-300">
          <StatusBanner status={botStatus} />
        </div>
        {/* Information Panel */}
        <MotionCard
          index={5}
          className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden"
        >
          <CardBody className="text-center">
            <p className="text-sm font-medium text-zinc-400">
              Please note that it may take some time for the viewers to appear
              on your live stream. This is normal, so please be patient.
            </p>
          </CardBody>
        </MotionCard>

        <Button
          ref={actionButtonRef}
          variant="solid"
          color={isLoading ? "danger" : "success"}
          size="lg"
          fullWidth
          onPress={isLoading ? handleStop : handleStart}
          isDisabled={
            botStatus.state.toLowerCase() === "stopping" ||
            botStatus.state.toLowerCase() === "starting" ||
            unactivated
          }
          className={`font-semibold ${botStatus.state.toLowerCase() === "stopping" ||
            botStatus.state.toLowerCase() === "starting"
            ? "opacity-50 cursor-not-allowed pointer-events-none"
            : ""
            }`}
        >
          <span className="relative z-10">
            {botStatus.state.toLowerCase() === "stopping"
              ? "Stopping"
              : botStatus.state.toLowerCase() === "starting"
                ? "Starting"
                : isLoading
                  ? "Stop Bot"
                  : "Start Bot"}
            {(botStatus.state.toLowerCase() === "stopping" ||
              botStatus.state.toLowerCase() === "starting") &&
              " (Please wait...)"}
          </span>
        </Button>
        
        {/* Terminal Logs Window */}
        <MotionCard delay={1.4}>
          <Card className="bg-zinc-950 border-zinc-800/50 mt-6 rounded-xl overflow-hidden">
            <CardHeader className="flex items-center gap-2 px-6 py-3 border-b border-zinc-800/50 bg-zinc-900/50">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5"></polyline>
                <line x1="12" y1="19" x2="20" y2="19"></line>
              </svg>
              <h2 className="text-sm font-semibold text-zinc-300">
                Live Terminal Logs
              </h2>
            </CardHeader>
            <CardBody className="p-0">
              <div className="bg-black p-4 font-mono text-xs overflow-y-auto h-64 flex flex-col-reverse">
                <div className="flex flex-col gap-1">
                  {wsLogs && wsLogs.length > 0 ? wsLogs.map((log, idx) => (
                    <div key={idx} className="text-gray-300 break-words">
                      <span className="text-green-500 mr-2">[{new Date().toLocaleTimeString()}]</span>
                      {log}
                    </div>
                  )) : (
                    <div className="text-zinc-600 italic">No logs generated yet. Click Start Bot to see activity.</div>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>
        </MotionCard>
      </div>
      <ToastContainer
        position="bottom-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="colored"
      />
    </div>
  );
}
