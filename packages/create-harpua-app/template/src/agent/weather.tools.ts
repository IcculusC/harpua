import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { LangGraphTool } from "@harpua/langgraph";

import { WEATHER_FETCH, type FetchFn } from "./fetch.token";

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

/** Open-Meteo geocoding response (only the fields we use). */
const geocodingSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        country: z.string().optional(),
        admin1: z.string().optional(),
      }),
    )
    .optional(),
});

/** Open-Meteo forecast response (only the current block). */
const forecastSchema = z.object({
  current: z.object({
    temperature_2m: z.number(),
    weather_code: z.number(),
    wind_speed_10m: z.number().optional(),
  }),
  current_units: z
    .object({
      temperature_2m: z.string().optional(),
      wind_speed_10m: z.string().optional(),
    })
    .optional(),
});

/** WMO weather-code → human phrase (a friendly subset of the standard table). */
function describeWeather(code: number): string {
  if (code === 0) return "clear sky";
  if (code <= 2) return "mostly clear";
  if (code === 3) return "overcast";
  if (code <= 48) return "foggy";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  return "thunderstorms";
}

@Injectable()
export class WeatherTools {
  constructor(@Inject(WEATHER_FETCH) private readonly fetchFn: FetchFn) {}

  @LangGraphTool({
    name: "get_weather",
    description:
      "Get the current weather for a location. Pass a city or place name.",
    schema: z.object({
      location: z
        .string()
        .describe("The location to get the weather for, e.g. 'Berlin'."),
    }),
  })
  async getWeather(input: { location: string }): Promise<string> {
    const place = await this.geocode(input.location);
    if (!place) {
      return `I couldn't find a place called "${input.location}". Try a nearby city or a different spelling.`;
    }

    const forecast = await this.forecast(place.latitude, place.longitude);
    const conditions = describeWeather(forecast.current.weather_code);
    const unit = forecast.current_units?.temperature_2m ?? "°C";
    const where = place.country ? `${place.name}, ${place.country}` : place.name;
    return `It's currently ${forecast.current.temperature_2m}${unit} and ${conditions} in ${where}.`;
  }

  private async geocode(location: string) {
    const url = `${GEOCODING_URL}?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
    const response = await this.fetchFn(url);
    const parsed = geocodingSchema.parse(await response.json());
    return parsed.results?.[0];
  }

  private async forecast(latitude: number, longitude: number) {
    const url = `${FORECAST_URL}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m`;
    const response = await this.fetchFn(url);
    return forecastSchema.parse(await response.json());
  }
}
