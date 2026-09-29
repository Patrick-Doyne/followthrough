package com.followthrough.api.controller;

import com.followthrough.api.dto.analytics.AnalyticsSummaryResponse;
import com.followthrough.api.dto.analytics.SeriesPointResponse;
import com.followthrough.api.service.AnalyticsService;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/analytics")
public class AnalyticsController {

    private final AnalyticsService analyticsService;

    public AnalyticsController(AnalyticsService analyticsService) {
        this.analyticsService = analyticsService;
    }

    @GetMapping("/summary")
    public AnalyticsSummaryResponse summary() {
        return analyticsService.summary();
    }

    @GetMapping("/shooting")
    public List<SeriesPointResponse> shooting() {
        return analyticsService.shootingSeries();
    }
}
