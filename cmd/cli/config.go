package cli

import (
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/Matbe34/lankir/internal/config"
	"github.com/Matbe34/lankir/internal/signature"
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
	Long:  `Get a specific configuration value, or every setting if no key is provided.`,
	Args:  cobra.MaximumNArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		cfg := loadConfig().Get()
		out := cmd.OutOrStdout()

		if len(args) == 0 {
			if jsonOutput {
				if err := printJSON(cmd, cfg); err != nil {
					ExitWithError("failed to marshal config to JSON", err)
				}
				return
			}
			for _, k := range configKeys(cfg) {
				k.print(out)
			}
			return
		}

		k, err := lookupConfigKey(cfg, args[0])
		if err != nil {
			ExitWithError(err.Error(), nil)
		}
		if jsonOutput {
			if err := printJSON(cmd, map[string]any{k.name: k.field.Interface()}); err != nil {
				ExitWithError("failed to marshal config value to JSON", err)
			}
			return
		}
		k.print(out)
	},
}

var configSetCmd = &cobra.Command{
	Use:   "set <key> <value>",
	Short: "Set configuration value",
	Long:  `Set a specific configuration value. Lists are changed with config add and config remove.`,
	Args:  cobra.ExactArgs(2),
	Run: func(cmd *cobra.Command, args []string) {
		service := loadConfig()
		cfg := service.Get()

		k, err := lookupConfigKey(cfg, args[0])
		if err != nil {
			ExitWithError(err.Error(), nil)
		}
		if err := k.set(args[1]); err != nil {
			ExitWithError(fmt.Sprintf("failed to set %s", k.name), err)
		}
		if err := service.Update(cfg); err != nil {
			ExitWithError("failed to save configuration", err)
		}

		GetLogger().Info("configuration updated", "key", k.name, "value", args[1])
		fmt.Fprintf(cmd.OutOrStdout(), "Configuration updated: %s = %s\n", k.name, args[1])
	},
}

// listOps changes the list settings through the signature service, which
// checks the paths the way the app's Settings do.
var listOps = map[string]struct {
	add, remove func(*signature.SignatureService, string) error
}{
	"certificateStores": {(*signature.SignatureService).AddCertificateStore, (*signature.SignatureService).RemoveCertificateStore},
	"tokenLibraries":    {(*signature.SignatureService).AddTokenLibrary, (*signature.SignatureService).RemoveTokenLibrary},
}

func listCommand(use, short string, remove bool) *cobra.Command {
	return &cobra.Command{
		Use:   use + " <key> <path>",
		Short: short,
		Long:  short + `. Keys: certificateStores (certificate folders) and tokenLibraries (PKCS#11 libraries).`,
		Args:  cobra.ExactArgs(2),
		Run: func(cmd *cobra.Command, args []string) {
			service := loadConfig()
			k, err := lookupConfigKey(service.Get(), args[0])
			if err != nil {
				ExitWithError(err.Error(), nil)
			}
			ops, ok := listOps[k.name]
			if !ok {
				ExitWithError(fmt.Sprintf("%s is not a list; use lankir config set", k.name), nil)
			}
			path, err := filepath.Abs(args[1])
			if err != nil {
				ExitWithError("invalid path", err)
			}
			op, done := ops.add, "added to"
			if remove {
				op, done = ops.remove, "removed from"
			}
			if err := op(signature.NewSignatureService(service), path); err != nil {
				ExitWithError(fmt.Sprintf("failed to %s %s", use, k.name), err)
			}

			GetLogger().Info("configuration updated", "key", k.name, use, path)
			fmt.Fprintf(cmd.OutOrStdout(), "%s %s %s\n", path, done, k.name)
		},
	}
}

var configAddCmd = listCommand("add", "Add a path to a list setting", false)
var configRemoveCmd = listCommand("remove", "Remove a path from a list setting", true)

var configResetCmd = &cobra.Command{
	Use:   "reset",
	Short: "Reset configuration to defaults",
	Long:  `Reset all configuration settings to their default values.`,
	Run: func(cmd *cobra.Command, args []string) {
		if err := loadConfig().Reset(); err != nil {
			ExitWithError("failed to reset configuration", err)
		}

		GetLogger().Info("configuration reset to defaults")
		fmt.Fprintln(cmd.OutOrStdout(), "Configuration reset to defaults")
	},
}

func init() {
	rootCmd.AddCommand(configCmd)
	configCmd.AddCommand(configGetCmd)
	configCmd.AddCommand(configSetCmd)
	configCmd.AddCommand(configAddCmd)
	configCmd.AddCommand(configRemoveCmd)
	configCmd.AddCommand(configResetCmd)

	configGetCmd.Flags().BoolVarP(&jsonOutput, "json", "j", false, "output in JSON format")
}

func loadConfig() *config.Service {
	service, err := config.NewService()
	if err != nil {
		ExitWithError("failed to create config service", err)
	}
	return service
}

// configKey is one config.json entry: its JSON name and the field of a Config
// that holds it.
type configKey struct {
	name  string
	field reflect.Value
}

// configKeys lists every config.json key of cfg in file order. It reads the
// Config struct, so a new setting is known here without being listed.
func configKeys(cfg *config.Config) []configKey {
	v := reflect.ValueOf(cfg).Elem()
	keys := make([]configKey, 0, v.NumField())
	for i := 0; i < v.NumField(); i++ {
		name, _, _ := strings.Cut(v.Type().Field(i).Tag.Get("json"), ",")
		keys = append(keys, configKey{name: name, field: v.Field(i)})
	}
	return keys
}

// lookupConfigKey finds a key by its config.json name, in any case.
func lookupConfigKey(cfg *config.Config, key string) (configKey, error) {
	for _, k := range configKeys(cfg) {
		if strings.EqualFold(k.name, key) {
			return k, nil
		}
	}
	return configKey{}, fmt.Errorf("unknown configuration key: %s (lankir config get lists them)", key)
}

// signingKeys are written by the app when you sign; config.Service.Update
// keeps their saved values, so setting them would silently do nothing.
var signingKeys = map[string]bool{"lastCertificateFingerprint": true, "lastSignatureProfileId": true}

// settingsLimits are the values the app's Settings dialog stores (SETTINGS in
// frontend/src/js/constants.js).
var settingsLimits = map[string]func(string) error{
	"theme": func(v string) error {
		if !slices.Contains([]string{"light", "dark", "auto"}, v) {
			return errors.New("theme must be light, dark or auto")
		}
		return nil
	},
	"accentColor": func(v string) error {
		if !hexColor.MatchString(v) {
			return errors.New("accentColor must be a colour as #rrggbb")
		}
		return nil
	},
	"defaultZoom":       intRange("defaultZoom", 10, 400),
	"recentFilesLength": intRange("recentFilesLength", 1, 50),
}

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func intRange(name string, lo, hi int) func(string) error {
	return func(v string) error {
		if n, err := strconv.Atoi(v); err == nil && (n < lo || n > hi) {
			return fmt.Errorf("%s must be from %d to %d", name, lo, hi)
		}
		return nil
	}
}

func (k configKey) set(value string) error {
	if signingKeys[k.name] {
		return fmt.Errorf("%s is saved by the app when you sign", k.name)
	}
	if limit, ok := settingsLimits[k.name]; ok {
		if err := limit(value); err != nil {
			return err
		}
	}
	switch k.field.Kind() {
	case reflect.Bool:
		v, err := strconv.ParseBool(value)
		if err != nil {
			return fmt.Errorf("invalid boolean value: %s", value)
		}
		k.field.SetBool(v)
	case reflect.Int:
		v, err := strconv.Atoi(value)
		if err != nil {
			return fmt.Errorf("invalid integer value: %s", value)
		}
		k.field.SetInt(int64(v))
	case reflect.String:
		k.field.SetString(value)
	case reflect.Slice:
		return fmt.Errorf("%s is a list; use lankir config add or lankir config remove", k.name)
	default:
		return fmt.Errorf("%s can't be set from the command line", k.name)
	}
	return nil
}

// print writes "key: value", or for a list the key and then one item per
// indented line.
func (k configKey) print(out io.Writer) {
	if k.field.Kind() != reflect.Slice {
		fmt.Fprintf(out, "%s: %v\n", k.name, k.field.Interface())
		return
	}
	if k.field.Len() == 0 {
		fmt.Fprintf(out, "%s: (none)\n", k.name)
		return
	}
	fmt.Fprintf(out, "%s:\n", k.name)
	for i := 0; i < k.field.Len(); i++ {
		fmt.Fprintf(out, "  %v\n", k.field.Index(i).Interface())
	}
}
