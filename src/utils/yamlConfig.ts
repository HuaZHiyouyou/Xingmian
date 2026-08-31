import yaml from 'js-yaml';
import { PlatformConfig, ModelConfig, defaultPlatforms } from '../store/configStore';

interface YamlPlatformConfig {
  displayName: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  models: YamlModelConfig[];
}

interface YamlModelConfig {
  name: string;
  type: 'chat' | 'vision' | 'audio' | 'video';
  enabled: boolean;
  pinned: boolean;
  enabledTypes?: ('chat' | 'vision' | 'audio' | 'video')[];
}

interface YamlConfig {
  platforms: YamlPlatformConfig[];
}

export function exportConfigToYaml(platforms: PlatformConfig[]): string {
  const yamlConfig: YamlConfig = {
    platforms: platforms.map((p) => ({
      displayName: p.displayName,
      enabled: p.enabled,
      apiKey: p.apiKey,
      baseUrl: p.baseUrl,
      models: p.models.filter((m) => m.pinned).map((m) => ({
        name: m.name,
        type: m.type,
        enabled: m.enabled,
        pinned: m.pinned,
        enabledTypes: m.enabledTypes && m.enabledTypes.length > 0 ? m.enabledTypes : [m.type],
      })),
    })),
  };

  return yaml.dump(yamlConfig, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
}

export function importConfigFromYaml(yamlContent: string): PlatformConfig[] {
  try {
    const parsed = yaml.load(yamlContent) as YamlConfig;
    if (!parsed || !parsed.platforms) return [...defaultPlatforms];

    return defaultPlatforms.map((defaultPlatform) => {
      const yamlPlatform = parsed.platforms.find(
        (p) => p.displayName === defaultPlatform.displayName
      );

      if (!yamlPlatform) return { ...defaultPlatform };

      const models: ModelConfig[] = (yamlPlatform.models || []).map((m) => ({
        name: m.name || '',
        type: m.type || 'chat',
        enabled: m.enabled ?? false,
        pinned: m.pinned ?? true,
        enabledTypes: (m.enabledTypes && m.enabledTypes.length > 0) ? m.enabledTypes : [m.type || 'chat'],
      }));

      return {
        enabled: yamlPlatform.enabled ?? defaultPlatform.enabled,
        apiKey: yamlPlatform.apiKey || '',
        baseUrl: yamlPlatform.baseUrl || defaultPlatform.baseUrl,
        displayName: yamlPlatform.displayName || defaultPlatform.displayName,
        models,
        fetchingModels: false,
      };
    });
  } catch {
    return [...defaultPlatforms];
  }
}

export function downloadYaml(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/yaml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadJson(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
