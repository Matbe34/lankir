package cli

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/ferran/pdf_app/internal/config"
	"github.com/spf13/cobra"
)

var configCmd = &cobra.Command{
	Use:   "config",
	Short: "Configuration management",
	Long:  `Manage application configuration settings.`,
}

var configGetCmd = &cobra.Command{
	Use:   "get [key]",
	Short: "Get configuration value(s)",
	Long:  `Get a specific configuration value or all configuration if no key is provided.`,
	Args:  cobra.MaximumNArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		service, err := config.NewService()
		if err != nil {
			ExitWithError("failed to create config service", err)
		}

		cfg := service.Get()

		if len(args) == 0 {
			if jsonOutput {
				data, _ := json.MarshalIndent(cfg, "", "  ")
				fmt.Println(string(data))
			} else {
				fmt.Println("Current Configuration:")
				fmt.Printf("\nAppearance:\n")
				fmt.Printf("  Theme:        %s\n", cfg.Theme)
				fmt.Printf("  Accent Color: %s\n", cfg.AccentColor)

				fmt.Printf("\nViewer:\n")
				fmt.Printf("  Default Zoom:       %d%%\n", cfg.DefaultZoom)
				fmt.Printf("  Show Left Sidebar:  %v\n", cfg.ShowLeftSidebar)
				fmt.Printf("  Show Right Sidebar: %v\n", cfg.ShowRightSidebar)
				fmt.Printf("  Default View Mode:  %s\n", cfg.DefaultViewMode)

				fmt.Printf("\nFiles:\n")
				fmt.Printf("  Recent Files Length: %d\n", cfg.RecentFilesLength)
				fmt.Printf("  Autosave Interval:   %d seconds\n", cfg.AutosaveInterval)

				fmt.Printf("\nCertificates:\n")
				fmt.Printf("  Certificate Stores:  %v\n", cfg.CertificateStores)
				fmt.Printf("  Token Libraries:     %v\n", cfg.TokenLibraries)

				fmt.Printf("\nAdvanced:\n")
				fmt.Printf("  Debug Mode:        %v\n", cfg.DebugMode)
				fmt.Printf("  Hardware Accel:    %v\n", cfg.HardwareAccel)
			}
			return
		}

		key := args[0]
		value := getConfigValue(cfg, key)

		if value == nil {
			ExitWithError(fmt.Sprintf("unknown configuration key: %s", key), nil)
		}

		if jsonOutput {
			result := map[string]interface{}{key: value}
			data, _ := json.MarshalIndent(result, "", "  ")
			fmt.Println(string(data))
		} else {
			fmt.Printf("%s: %v\n", key, value)
		}
	},
}

var configSetCmd = &cobra.Command{
	Use:   "set <key> <value>",
	Short: "Set configuration value",
	Long:  `Set a specific configuration value.`,
	Args:  cobra.ExactArgs(2),
	Run: func(cmd *cobra.Command, args []string) {
		key := args[0]
		valueStr := args[1]

		service, err := config.NewService()
		if err != nil {
			ExitWithError("failed to create config service", err)
		}

		cfg := service.Get()

		if err := setConfigValue(cfg, key, valueStr); err != nil {
			ExitWithError(fmt.Sprintf("failed to set %s", key), err)
		}

		if err := service.Update(cfg); err != nil {
			ExitWithError("failed to save configuration", err)
		}

		GetLogger().Info("configuration updated", "key", key, "value", valueStr)
		fmt.Printf("Configuration updated: %s = %s\n", key, valueStr)
	},
}

var configResetCmd = &cobra.Command{
	Use:   "reset",
	Short: "Reset configuration to defaults",
	Long:  `Reset all configuration settings to their default values.`,
	Run: func(cmd *cobra.Command, args []string) {
		service, err := config.NewService()
		if err != nil {
			ExitWithError("failed to create config service", err)
		}

		if err := service.Reset(); err != nil {
			ExitWithError("failed to reset configuration", err)
		}

		GetLogger().Info("configuration reset to defaults")
		fmt.Println("Configuration reset to defaults")
	},
}

func init() {
	rootCmd.AddCommand(configCmd)
	configCmd.AddCommand(configGetCmd)
	configCmd.AddCommand(configSetCmd)
	configCmd.AddCommand(configResetCmd)

	configGetCmd.Flags().BoolVarP(&jsonOutput, "json", "j", false, "output in JSON format")
}

func getConfigValue(cfg *config.Config, key string) interface{} {
	switch strings.ToLower(key) {
	case "theme":
		return cfg.Theme
	case "accentcolor":
		return cfg.AccentColor
	case "defaultzoom":
		return cfg.DefaultZoom
	case "showleftsidebar":
		return cfg.ShowLeftSidebar
	case "showrightsidebar":
		return cfg.ShowRightSidebar
	case "defaultviewmode":
		return cfg.DefaultViewMode
	case "recentfileslength":
		return cfg.RecentFilesLength
	case "autosaveinterval":
		return cfg.AutosaveInterval
	case "certificatestores":
		return cfg.CertificateStores
	case "tokenlibraries":
		return cfg.TokenLibraries
	case "debugmode":
		return cfg.DebugMode
	case "hardwareaccel":
		return cfg.HardwareAccel
	default:
		return nil
	}
}

func setConfigValue(cfg *config.Config, key, value string) error {
	switch strings.ToLower(key) {
	case "theme":
		cfg.Theme = value
	case "accentcolor":
		cfg.AccentColor = value
	case "defaultzoom":
		v, err := strconv.Atoi(value)
		if err != nil {
			return fmt.Errorf("invalid integer value: %s", value)
		}
		cfg.DefaultZoom = v
	case "showleftsidebar":
		v, err := strconv.ParseBool(value)
		if err != nil {
			return fmt.Errorf("invalid boolean value: %s", value)
		}
		cfg.ShowLeftSidebar = v
	case "showrightsidebar":
		v, err := strconv.ParseBool(value)
		if err != nil {
			return fmt.Errorf("invalid boolean value: %s", value)
		}
		cfg.ShowRightSidebar = v
	case "defaultviewmode":
		cfg.DefaultViewMode = value
	case "recentfileslength":
		v, err := strconv.Atoi(value)
		if err != nil {
			return fmt.Errorf("invalid integer value: %s", value)
		}
		cfg.RecentFilesLength = v
	case "autosaveinterval":
		v, err := strconv.Atoi(value)
		if err != nil {
			return fmt.Errorf("invalid integer value: %s", value)
		}
		cfg.AutosaveInterval = v
	case "debugmode":
		v, err := strconv.ParseBool(value)
		if err != nil {
			return fmt.Errorf("invalid boolean value: %s", value)
		}
		cfg.DebugMode = v
	case "hardwareaccel":
		v, err := strconv.ParseBool(value)
		if err != nil {
			return fmt.Errorf("invalid boolean value: %s", value)
		}
		cfg.HardwareAccel = v
	default:
		return fmt.Errorf("unknown configuration key: %s", key)
	}
	return nil
}
