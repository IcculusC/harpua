import { WeatherTools } from "../weather.tools";
import type { FetchFn } from "../fetch.token";

/** Canned Open-Meteo payloads keyed by which endpoint the URL targets. */
function cannedFetch(
  overrides: { geocoding?: unknown; forecast?: unknown } = {},
): { fetchFn: FetchFn; calls: string[] } {
  const calls: string[] = [];
  const fetchFn: FetchFn = async (url: string) => {
    calls.push(url);
    const body = url.includes("geocoding")
      ? (overrides.geocoding ?? {
          results: [
            {
              name: "Berlin",
              latitude: 52.52,
              longitude: 13.41,
              country: "Germany",
            },
          ],
        })
      : (overrides.forecast ?? {
          current: {
            temperature_2m: 21.3,
            weather_code: 0,
            wind_speed_10m: 5,
          },
          current_units: { temperature_2m: "°C" },
        });
    return { json: async () => body };
  };
  return { fetchFn, calls };
}

describe("WeatherTools.getWeather", () => {
  it("geocodes then forecasts and summarizes the result", async () => {
    const { fetchFn, calls } = cannedFetch();
    const tools = new WeatherTools(fetchFn);

    const result = await tools.getWeather({ location: "Berlin" });

    expect(result).toContain("21.3°C");
    expect(result).toContain("clear sky");
    expect(result).toContain("Berlin, Germany");
    // Both endpoints were exercised through the injected fetch.
    expect(calls[0]).toContain("geocoding-api.open-meteo.com");
    expect(calls[1]).toContain("api.open-meteo.com/v1/forecast");
    expect(calls[1]).toContain("latitude=52.52");
  });

  it("returns a friendly message for an unknown location (empty geocoding)", async () => {
    const { fetchFn, calls } = cannedFetch({ geocoding: { results: [] } });
    const tools = new WeatherTools(fetchFn);

    const result = await tools.getWeather({ location: "Nowheresville" });

    expect(result).toContain("couldn't find");
    expect(result).toContain("Nowheresville");
    // No forecast call once geocoding found nothing.
    expect(calls).toHaveLength(1);
  });

  it("rejects a malformed forecast payload via zod parsing", async () => {
    const { fetchFn } = cannedFetch({ forecast: { current: {} } });
    const tools = new WeatherTools(fetchFn);

    await expect(tools.getWeather({ location: "Berlin" })).rejects.toThrow();
  });
});
