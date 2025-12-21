package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var guiCmd = &cobra.Command{
	Use:   "gui",
	Short: "Launch the graphical user interface",
	Long:  `Launch the Lankir graphical user interface (GUI).`,
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Println("Launching GUI...")
		if guiFunc != nil {
			guiFunc()
		} else {
			fmt.Fprintln(os.Stderr, "Error: GUI mode is not available")
			os.Exit(1)
		}
	},
}

func init() {
	rootCmd.AddCommand(guiCmd)
}
