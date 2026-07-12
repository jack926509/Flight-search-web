from services.station_scan_service import build_tasks, dates_inclusive


def test_station_scan_builds_tpe_baseline_and_each_station_date():
    dates = dates_inclusive("2026-08-01", "2026-08-02")
    assert build_tasks(["BKK", "SIN"], dates) == [
        ("TPE", "2026-08-01"), ("TPE", "2026-08-02"),
        ("BKK", "2026-08-01"), ("BKK", "2026-08-02"),
        ("SIN", "2026-08-01"), ("SIN", "2026-08-02"),
    ]
