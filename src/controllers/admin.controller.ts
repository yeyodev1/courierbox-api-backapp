import type { Request, Response, NextFunction } from "express";
import { GHLService } from "../services/ghl.service.js";

// Basic in-memory cache to prevent hitting GHL rate limits on multiple concurrent requests
const cache = {
  users: { data: null as any, timestamp: 0 },
  conversations: { data: null as any, timestamp: 0 }
};
const CACHE_TTL = 60 * 1000; // 1 minute

async function getCachedGHLData(locationId: string) {
  const now = Date.now();
  let usersData = cache.users.data;
  let convData = cache.conversations.data;

  const usersPromise = (now - cache.users.timestamp > CACHE_TTL)
    ? GHLService.getUsers(locationId).then(res => {
        if (res && res.users) {
          cache.users.data = res;
          cache.users.timestamp = Date.now();
        }
        return res;
      }).catch(err => {
        console.error("[GHL cache users error]", err.response?.data || err.message);
        return { error: err.message };
      })
    : Promise.resolve(usersData);

  const convPromise = (now - cache.conversations.timestamp > CACHE_TTL)
    ? GHLService.getConversationsSearch(locationId, 100).then(res => {
        if (res && res.conversations) {
          cache.conversations.data = res;
          cache.conversations.timestamp = now;
        }
        return res;
      }).catch(err => {
        console.error("[GHL cache conv error]", err.response?.data || err.message);
        return { error: err.message };
      })
    : Promise.resolve(cache.conversations.data);

  const [usersResponse, conversationsResponse] = await Promise.all([usersPromise, convPromise]);
  return { usersResponse, conversationsResponse };
}

function parseDates(startDate?: string, endDate?: string) {
  const now = new Date();
  const defaultStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const start = startDate ? new Date(startDate) : defaultStart;
  const end = endDate ? new Date(endDate) : now;
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function filterConversations(conversations: any[], start: Date, end: Date) {
  return conversations.filter((c: any) => {
    // Use dateUpdated so we track conversations that had activity in this period, not just created.
    const updated = new Date(c.dateUpdated || c.dateAdded);
    return updated >= start && updated <= end;
  });
}

// Ensure messages for the conversation are fetched and calculate response time
async function enrichConversationsWithMessages(filteredConversations: any[]) {
  const messagesPromises = filteredConversations.slice(0, 50).map((c: any) => 
    GHLService.getConversationMessages(c.id).catch(() => null)
  );
  const messagesResults = await Promise.all(messagesPromises);

  filteredConversations.slice(0, 50).forEach((c: any, idx: number) => {
    const msgsData = messagesResults[idx];
    const messages = msgsData?.messages?.messages || msgsData?.messages || []; 
    
    messages.sort((a: any, b: any) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime());

    let hasInbound = false;
    let hasOutbound = false;
    let responseTimesMs: number[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.direction === 'inbound') {
        hasInbound = true;
        let nextOutbound = null;
        for (let j = i + 1; j < messages.length; j++) {
          if (messages[j].direction === 'outbound') {
            nextOutbound = messages[j];
            break;
          }
        }
        if (nextOutbound) {
          hasOutbound = true;
          const time = new Date(nextOutbound.dateAdded).getTime() - new Date(msg.dateAdded).getTime();
          if (time >= 0) responseTimesMs.push(time);
        }
      } else if (msg.direction === 'outbound') {
        hasOutbound = true;
      }
    }

    const avgResponseTimeMs = responseTimesMs.length > 0 
      ? responseTimesMs.reduce((a, b) => a + b, 0) / responseTimesMs.length 
      : null;

    c.avgResponseTimeMs = avgResponseTimeMs;
    c.answeredOutsideCrm = hasInbound && !hasOutbound;
    c.messages = messages; // Added so frontend can display chat history
  });

  return filteredConversations;
}

export async function getGeneralMetrics(req: Request, res: Response, next: NextFunction) {
  try {
    const locationId = req.query.locationId as string;
    if (!locationId) return res.status(400).send({ error: "Bad Request", message: "locationId is required." });

    const { usersResponse, conversationsResponse } = await getCachedGHLData(locationId);
    const users = usersResponse?.users || [];
    const conversations = conversationsResponse?.conversations || [];

    const todayStr = new Date().toISOString().split('T')[0];
    
    // Instead of filtering by dates, we use the latest 100 conversations directly
    const enrichedConversations = await enrichConversationsWithMessages(conversations.slice(0, 100));


    // Ensure we always return at least the last 14 days for the chart to look like a timeline
    const dailyStatsRecord: Record<string, number> = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dailyStatsRecord[d.toISOString().split('T')[0]] = 0;
    }
    
    let todayConversationsCount = 0;
    let totalResponseTime = 0;
    let totalResponseCount = 0;
    let todayResponseTime = 0;
    let todayResponseCount = 0;

    enrichedConversations.forEach((c: any) => {
      // Group and count based on dateUpdated (activity date)
      const dateKey = new Date(c.dateUpdated || c.dateAdded).toISOString().split('T')[0];
      
      // Only record if it's within our 14-day window (it should be, since these are the 100 latest)
      if (dailyStatsRecord[dateKey] !== undefined) {
        dailyStatsRecord[dateKey] += 1;
      } else {
        // If older, just create the key
        dailyStatsRecord[dateKey] = 1;
      }
      
      const isToday = (dateKey === todayStr);

      if (isToday) {
        todayConversationsCount++;
      }

      if (c.avgResponseTimeMs !== null && c.avgResponseTimeMs !== undefined) {
        totalResponseTime += c.avgResponseTimeMs;
        totalResponseCount++;
        
        if (isToday) {
          todayResponseTime += c.avgResponseTimeMs;
          todayResponseCount++;
        }
      }
    });

    const dailyStats = Object.keys(dailyStatsRecord)
      .sort()
      .map(date => ({ date, count: dailyStatsRecord[date] }));

    const overallAvgResponseTimeMs = totalResponseCount > 0 ? Math.round(totalResponseTime / totalResponseCount) : 0;
    const todayAvgResponseTimeMs = todayResponseCount > 0 ? Math.round(todayResponseTime / todayResponseCount) : null;

    res.status(200).send({
      message: "General metrics retrieved successfully.",
      data: {
        totalUsers: users.length,
        activeConversations: enrichedConversations.length,
        todayConversations: todayConversationsCount,
        overallAvgResponseTimeMs,
        todayAvgResponseTimeMs,
        dailyStats
      }
    });
  } catch (error) {
    console.error("[AdminController] getGeneralMetrics error:", error);
    next(error);
  }
}

export async function getAgentMetrics(req: Request, res: Response, next: NextFunction) {
  try {
    const locationId = req.query.locationId as string;
    if (!locationId) return res.status(400).send({ error: "Bad Request", message: "locationId is required." });

    const { usersResponse, conversationsResponse } = await getCachedGHLData(locationId);
    const users = usersResponse?.users || [];
    const conversations = conversationsResponse?.conversations || [];

    const enrichedConversations = await enrichConversationsWithMessages(conversations.slice(0, 100));

    const stats: Record<string, { id: string, name: string, email: string, role: string, total: number, open: number, closed: number, responseTimesMs: number[], untrackable: number, avgResponseTimeMs: number | null }> = {};
    
    users.forEach((u: any) => {
      stats[u.id] = { id: u.id, name: u.name, email: u.email, role: u.roles?.role || 'user', total: 0, open: 0, closed: 0, responseTimesMs: [], untrackable: 0, avgResponseTimeMs: null };
    });

    enrichedConversations.forEach((c: any) => {
      const agentId = c.assignedTo;
      if (agentId) {
        if (!stats[agentId]) stats[agentId] = { id: agentId, name: 'Unknown', email: '', role: 'user', total: 0, open: 0, closed: 0, responseTimesMs: [], untrackable: 0, avgResponseTimeMs: null };
        stats[agentId].total++;
        if (c.status === 'open' || c.status === 'unread') {
          stats[agentId].open++;
        } else {
          stats[agentId].closed++;
        }
        if (c.avgResponseTimeMs !== null && c.avgResponseTimeMs !== undefined) {
          stats[agentId].responseTimesMs.push(c.avgResponseTimeMs);
        }
        if (c.answeredOutsideCrm) {
          stats[agentId].untrackable++;
        }
      }
    });

    // Calculate averages
    Object.values(stats).forEach(stat => {
      stat.avgResponseTimeMs = stat.responseTimesMs.length > 0 
        ? stat.responseTimesMs.reduce((a, b) => a + b, 0) / stat.responseTimesMs.length 
        : null;
    });

    res.status(200).send({
      message: "Agent metrics retrieved successfully.",
      data: Object.values(stats).filter(s => s.total > 0 || users.some((u: any) => u.id === s.id)) // return all users or those with stats
    });
  } catch (error) {
    console.error("[AdminController] getAgentMetrics error:", error);
    next(error);
  }
}

export async function getRecentConversations(req: Request, res: Response, next: NextFunction) {
  try {
    const locationId = req.query.locationId as string;
    if (!locationId) return res.status(400).send({ error: "Bad Request", message: "locationId is required." });

    const { conversationsResponse } = await getCachedGHLData(locationId);
    const conversations = conversationsResponse?.conversations || [];

    const enrichedConversations = await enrichConversationsWithMessages(conversations.slice(0, 100));

    // Sort by most recent update
    enrichedConversations.sort((a: any, b: any) => new Date(b.dateUpdated || b.dateAdded).getTime() - new Date(a.dateUpdated || a.dateAdded).getTime());

    res.status(200).send({
      message: "Recent conversations retrieved successfully.",
      data: enrichedConversations.slice(0, 50) // Return top 50
    });
  } catch (error) {
    console.error("[AdminController] getRecentConversations error:", error);
    next(error);
  }
}

export async function getDailyChart(req: Request, res: Response, next: NextFunction) {
  try {
    const locationId = req.query.locationId as string;
    if (!locationId) {
      return res.status(400).send({ error: "locationId is required" });
    }

    const now = Date.now();
    const CACHE_TTL = 5 * 60 * 1000;
    
    // Trigger update if old
    const convPromise = (now - cache.conversations.timestamp > CACHE_TTL)
      ? GHLService.getConversationsSearch(locationId, 100).then(res => {
          if (res && res.conversations) {
            cache.conversations.data = res;
            cache.conversations.timestamp = now;
          }
          return res;
        }).catch(err => {
          console.error("[GHL cache conv error]", err.response?.data || err.message);
          return { error: err.message };
        })
      : Promise.resolve(cache.conversations.data);

    let conversationsResponse;
    if (cache.conversations.data) {
      conversationsResponse = cache.conversations.data;
    } else {
      conversationsResponse = await convPromise;
    }

    if (conversationsResponse.error) {
      return res.status(422).send({ message: "GoHighLevel API Error", error: conversationsResponse.error });
    }

    const conversations = conversationsResponse?.conversations || [];

    // Ensure we always return at least the last 14 days for the chart to look like a timeline
    const dailyStatsRecord: Record<string, number> = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dailyStatsRecord[d.toISOString().split('T')[0]] = 0;
    }

    conversations.forEach((c: any) => {
      if (!c.dateUpdated && !c.dateAdded) return;
      const dateKey = new Date(c.dateUpdated || c.dateAdded).toISOString().split('T')[0];
      
      // Only record if it's within our 14-day window
      if (dailyStatsRecord[dateKey] !== undefined) {
        dailyStatsRecord[dateKey] += 1;
      }
    });

    const dailyStats = Object.keys(dailyStatsRecord)
      .sort()
      .map(date => ({ date, count: dailyStatsRecord[date] }));

    res.status(200).send({
      message: "Daily chart retrieved successfully.",
      data: dailyStats
    });
  } catch (error) {
    console.error("[AdminController] Error getDailyChart:", error);
    next(error);
  }
}
