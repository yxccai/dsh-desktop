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

    // Edited after creation: this line makes the demo visibly different.
    std::cout << "Resizable right-side Grid panel is ready — drag its left edge.\n";
    return 0;
}
