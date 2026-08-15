#include <iostream>
#include <string>
#include <vector>

struct PreviewItem {
    std::string name;
    bool modified;
};

int main() {
    const std::vector<PreviewItem> files {
        {"main.cpp", true},
        {"README.md", false},
        {"preview.html", true},
    };

    std::cout << "DSH Desktop project preview demo\n";
    for (const auto& file : files) {
        std::cout << (file.modified ? "[modified] " : "[clean] ")
                  << file.name << '\n';
    }

    // Committed files still belong to a turn and remain recoverable by snapshots.
    std::cout << "DSH preview auto-opens this committed C++ file.\n";
    std::cout << "Drag the divider mounted directly on the DSH frame.\n";
    return 0;
}
